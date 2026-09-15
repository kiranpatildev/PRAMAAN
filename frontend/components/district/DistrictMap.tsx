"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Empty } from "../ui/Empty";
import { Button } from "../ui/Button";
import type { DistrictGeo } from "@/lib/endpoints";
import "maplibre-gl/dist/maplibre-gl.css";

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
  const [tileWarn, setTileWarn] = useState("");
  const [baseLabel, setBaseLabel] = useState("");
  const [retry, setRetry] = useState(0);
  const [empty, setEmpty] = useState(false);
  const fittedRef = useRef(false);

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

  const upgradeGen = useRef(0);
  const mountedRef = useRef(false);

  function attachMap(map: import("maplibre-gl").Map) {
    mapRef.current = map as never;
    const ml = mlRef.current;
    if (ml) map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-left");
    setupLayers();
    // Refit only on first mount; upgrades preserve the user's view.
    if (!fittedRef.current) {
      fittedRef.current = true;
      const list = liveRef.current.districts;
      const first = list[0];
      if (first && ml) {
        try {
          const b = new ml.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
          for (const d of list.slice(1)) b.extend([d.lng, d.lat]);
          map.fitBounds(b, { padding: 70, maxZoom: 6 });
        } catch { /* ignore */ }
      }
    }
    let errorCount = 0;
    map.on("error", () => {
      errorCount += 1;
      if (errorCount < 4 || mapRef.current !== (map as never)) return;
      setTileWarn("Base tiles degraded. Data below is unaffected.");
    });
  }

  async function runUpgrade() {
    const gen = ++upgradeGen.current;
    const t0 = Date.now();
    while (!mountedRef.current && Date.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 150));
      if (gen !== upgradeGen.current) return;
    }
    const ml = mlRef.current;
    if (!ml || !mountedRef.current || gen !== upgradeGen.current) return;
    const { upgradeCandidates, raceCandidates, awaitMapLoad, createMapTransformRequest, logTile } = await import("@/lib/mapStyles");
    if (gen !== upgradeGen.current) return;
    const cands = upgradeCandidates();
    const start = Date.now();
    const win = await raceCandidates(ml as never, cands, {
      isCancelled: () => gen !== upgradeGen.current,
      onProbe: (label, ok, ms) => logTile("candidate-probe", `${label} → ${ok ? "VERIFIED" : "failed"} in ${ms}ms`),
    });
    if (!win || gen !== upgradeGen.current) {
      if (!win && gen === upgradeGen.current) {
        setBaseLabel("Offline base");
        setTileWarn("Live tiles unreachable — offline base. District data below is live.");
        logTile("upgrade", `all ${cands.length} candidates failed in ${Date.now() - start}ms`);
      }
      return;
    }

    // Winner found! Prepare swap without destroying current map
    const prev = mapRef.current as unknown as import("maplibre-gl").Map | null;
    let center: [number, number] = [78.9, 21.1];
    let zoom = 4;
    try {
      if (prev) {
        const cc = prev.getCenter();
        center = [cc.lng, cc.lat];
        zoom = prev.getZoom();
      }
    } catch { /* ignore */ }

    if (!divRef.current || gen !== upgradeGen.current) return;
    const staging = document.createElement("div");
    staging.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    divRef.current.appendChild(staging);

    try {
      const map = new ml.Map({
        container: staging,
        style: win.style as never,
        center,
        zoom,
        transformRequest: createMapTransformRequest(),
        attributionControl: { compact: true },
      });
      const loaded = await awaitMapLoad(map, 6000);
      if (!loaded || gen !== upgradeGen.current) {
        try { map.remove(); } catch { /* ignore */ }
        try { staging.remove(); } catch { /* ignore */ }
        setTileWarn("Live tiles flickered — staying on the working base.");
        return;
      }

      // Successfully loaded! Now remove prev and cleanup old container
      try { prev?.remove(); } catch { /* ignore */ }
      if (divRef.current) {
        Array.from(divRef.current.children).forEach((el) => {
          if (el !== staging) el.remove();
        });
      }
      attachMap(map);
      setBaseLabel(`${win.label} · live`);
      setTileError("");
      setTileWarn("");
      logTile("upgrade", `${win.label} live in ${Date.now() - start}ms`);
      return;
    } catch {
      try { staging.remove(); } catch { /* ignore */ }
      return;
    }
  }

  // Mount once: offline base instantly (district pins live in <1s).
  useEffect(() => {
    let dead = false;
    let ro: ResizeObserver | null = null;
    const genRef = upgradeGen;
    const mountRef = mountedRef;
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
        const { loadBoundaries, buildOfflineStyle, awaitMapLoad, createMapTransformRequest, logTile } = await import("@/lib/mapStyles");
        const t0 = performance.now();
        const bounds = await loadBoundaries();
        if (dead || !divRef.current) return;
        const map = new ml.Map({
          container: divRef.current,
          style: buildOfflineStyle(bounds) as never,
          center: [78.9, 21.1],
          zoom: 4,
          transformRequest: createMapTransformRequest(),
          attributionControl: { compact: true },
        });
        await awaitMapLoad(map, 4000);
        if (dead) {
          try { map.remove(); } catch { /* ignore */ }
          return;
        }
        attachMap(map);
        mountedRef.current = true;
        setBaseLabel("Offline base · locating live tiles…");
        logTile("offline-mount", `${Math.round(performance.now() - t0)}ms`);
        ro = new ResizeObserver(() => {
          try { mapRef.current?.resize(); } catch { /* ignore */ }
        });
        if (divRef.current) ro.observe(divRef.current);
      } catch {
        if (!dead) setTileError("Map failed to start. Check your connection and retry.");
      }
    })();
    return () => {
      dead = true;
      genRef.current++;
      mountRef.current = false;
      try { ro?.disconnect(); } catch { /* ignore */ }
      try { popupRef.current?.remove(); } catch { /* ignore */ }
      try { mapRef.current?.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background live-tile upgrade; manual Retry re-runs it.
  useEffect(() => {
    const genRef = upgradeGen;
    void runUpgrade();
    return () => {
      genRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

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
      {tileWarn && !tileError ? (
        <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-md border border-amber-500/30 bg-[#1a1407]/95 px-3 py-2">
          <MapPin size={13} strokeWidth={1.8} aria-hidden className="shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-amber-200" title={tileWarn}>
            {tileWarn}
          </p>
          {baseLabel ? (
            <span className="shrink-0 rounded border border-line-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-3">
              {baseLabel}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setTileWarn("");
              setRetry((n) => n + 1);
            }}
            className="shrink-0 rounded border border-line-2 px-2 py-0.5 font-mono text-[10.5px] text-fg-2 hover:border-cyan hover:text-fg"
          >
            Retry
          </button>
        </div>
      ) : null}
      {!tileWarn && !tileError && baseLabel ? (
        <div className="absolute right-3 top-3 z-10 rounded border border-line bg-panel/90 px-2 py-1 font-mono text-[10px] text-fg-4">
          {baseLabel}
        </div>
      ) : null}
      {tileError ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg p-6">
          <Empty icon={MapPin} title="Map unavailable" body={tileError} />
          <Button variant="ghost" small onClick={() => { setTileError(""); setRetry((n) => n + 1); }}>
            Retry map
          </Button>
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
