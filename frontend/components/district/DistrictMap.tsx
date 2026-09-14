"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Empty } from "../ui/Empty";
import type { DistrictGeo } from "@/lib/endpoints";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function DistrictMap({ districts, selected, onSelect }: {
  districts: DistrictGeo[];
  selected: string | null;
  onSelect: (district: string) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  const liveRef = useRef({ districts, selected, onSelect });
  liveRef.current = { districts, selected, onSelect };
  const [tileError, setTileError] = useState("");
  const [empty, setEmpty] = useState(false);

  const clickRef = useRef<((e: import("maplibre-gl").MapMouseEvent & {
    features?: import("maplibre-gl").MapGeoJSONFeature[];
  }) => void) | null>(null);
  if (!clickRef.current) {
    clickRef.current = (e) => {
      const name = e.features?.[0]?.properties?.["district"];
      if (typeof name !== "string") return;
      const row = liveRef.current.districts.find((d) => d.district === name);
      if (!row) return;
      const ml2 = mlRef.current;
      const map2 = mapRef.current;
      if (!ml2 || !map2) return;
      popupRef.current?.remove();
      const el = document.createElement("div");
      el.className = "map-pin-card";
      el.innerHTML =
        `<b>${escapeHtml(row.district)}</b>` +
        `<span>${row.cases} case${row.cases === 1 ? "" : "s"} · ` +
        `${row.entities} entities · ${row.evidence} files</span>` +
        `<button type="button">View district</button>`;
      el.querySelector("button")?.addEventListener("click", () => liveRef.current.onSelect(row.district));
      popupRef.current = new ml2.Popup({ closeButton: true, maxWidth: "240px" })
        .setLngLat([row.lng, row.lat])
        .setDOMContent(el)
        .addTo(map2);
    };
  }

  function syncData() {
    const map = mapRef.current;
    if (!map) return;
    const list = liveRef.current.districts;
    const feats = list.map((d) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [d.lng, d.lat] },
      properties: { district: d.district, cases: d.cases, entities: d.entities },
    }));
    const pins = map.getSource("district-pins") as { setData?: (d: unknown) => void } | undefined;
    pins?.setData?.({ type: "FeatureCollection", features: feats });
    const heat = map.getSource("district-heat") as { setData?: (d: unknown) => void } | undefined;
    heat?.setData?.({ type: "FeatureCollection", features: feats });
    const sel = liveRef.current.selected;
    const ring = map.getSource("district-ring") as { setData?: (d: unknown) => void } | undefined;
    const match = sel ? list.find((d) => d.district === sel) : undefined;
    ring?.setData?.({
      type: "FeatureCollection",
      features: match
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [match.lng, match.lat] }, properties: {} }]
        : [],
    });
    setEmpty(list.length === 0);
  }

  function setupLayers() {
    const map = mapRef.current;
    if (!map) return;
    for (const src of ["district-pins", "district-heat", "district-ring"] as const) {
      if (!map.getSource(src)) {
        map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
    }
    if (!map.getLayer("district-pins")) {
      map.addLayer({
        id: "district-pins", type: "circle", source: "district-pins",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "cases"], 1], 1, 7, 10, 15],
          "circle-color": "#00d9ff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0d1117",
        },
      });
    }
    if (!map.getLayer("district-heat")) {
      map.addLayer(
        {
          id: "district-heat", type: "heatmap", source: "district-heat",
          maxzoom: 12,
          paint: {
            "heatmap-weight": ["coalesce", ["get", "entities"], 1],
            "heatmap-intensity": 1,
            "heatmap-radius": 48,
            "heatmap-opacity": 0.8,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.3, "rgba(251,191,36,0.55)",
              0.7, "rgba(251,146,60,0.8)",
              1, "rgba(248,113,113,0.9)",
            ],
          },
        },
        "district-pins"
      );
    }
    if (!map.getLayer("district-ring")) {
      map.addLayer({
        id: "district-ring", type: "circle", source: "district-ring",
        paint: {
          "circle-radius": 16, "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
        },
      });
    }
    const onClick = clickRef.current;
    if (onClick) {
      try { map.off("click", "district-pins", onClick); } catch { /* ignore */ }
      map.on("click", "district-pins", onClick);
    }
    syncData();
  }

  useEffect(() => {
    let dead = false;
    let loadTimer: ReturnType<typeof setTimeout> | null = null;
    let ro: ResizeObserver | null = null;
    (async () => {
      let ml: typeof import("maplibre-gl");
      try {
        ml = await import("maplibre-gl");
      } catch {
        if (!dead) setTileError("Map library failed to load. Check your connection and retry.");
        return;
      }
      if (dead || !divRef.current) return;
      mlRef.current = ml;
      try {
        const map = new ml.Map({
          container: divRef.current,
          style: STYLE_URL,
          center: [78.9, 21.1],
          zoom: 4,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-left");
        map.on("error", () => {
          if (!dead) setTileError("Map tiles failed to load (OpenFreeMap unreachable). Data below is unaffected — retry shortly.");
        });
        map.on("load", () => {
          if (loadTimer) clearTimeout(loadTimer);
          if (dead) return;
          setTileError("");
          setupLayers();
          const list = liveRef.current.districts;
          const first = list[0];
          if (first) {
            try {
              const b = new ml.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
              for (const d of list.slice(1)) b.extend([d.lng, d.lat]);
              map.fitBounds(b, { padding: 70, maxZoom: 6 });
            } catch { /* ignore */ }
          }
        });
        loadTimer = setTimeout(() => {
          if (!dead) setTileError("Map tiles are taking too long (OpenFreeMap unreachable?). Data below is unaffected — retry shortly.");
        }, 20000);
        ro = new ResizeObserver(() => {
          try { map.resize(); } catch { /* ignore */ }
        });
        ro.observe(divRef.current);
      } catch {
        if (!dead) setTileError("Map failed to start. Check your connection and retry.");
      }
    })();
    return () => {
      dead = true;
      if (loadTimer) clearTimeout(loadTimer);
      try { ro?.disconnect(); } catch { /* ignore */ }
      try { popupRef.current?.remove(); } catch { /* ignore */ }
      try { mapRef.current?.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // syncData is ref-stable by construction (reads only liveRef/mapRef).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncData(); }, [districts, selected]);

  return (
    <div className="relative min-h-[380px] overflow-hidden rounded-md border border-line bg-bg">
      <style>{`.map-pin-card{display:flex;flex-direction:column;gap:4px;max-width:230px;color:#e6edf3}
.map-pin-card b{font-size:12.5px;font-weight:600}
.map-pin-card span{font-size:11.5px;color:#a3b1c2}
.map-pin-card button{margin-top:4px;border:1px solid #00d9ff55;border-radius:3px;color:#00d9ff;font-family:monospace;font-size:11px;padding:4px 8px;cursor:pointer;background:transparent}
.maplibregl-popup-content{background:#0d1117!important;border:1px solid #1a2230;border-radius:6px!important;padding:10px 12px!important}
.maplibregl-popup-content .map-pin-card{color:#e6edf3}
.maplibregl-popup-tip{border-top-color:#1a2230!important;border-bottom-color:#1a2230!important}
.maplibregl-popup-close-button{color:#a3b1c2!important}`}</style>
      <div ref={divRef} className="absolute inset-0" role="application" aria-label="District density map" />
      {tileError ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg p-6">
          <Empty icon={MapPin} title="Map unavailable" body={tileError} />
        </div>
      ) : null}
      {empty && !tileError ? (
        <div className="absolute left-3 top-3 z-10 rounded border border-line bg-panel px-3 py-2 font-mono text-[11px] text-fg-3">
          No plottable districts yet.
        </div>
      ) : null}
    </div>
  );
}
