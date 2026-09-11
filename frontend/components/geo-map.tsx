"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import "maplibre-gl/dist/maplibre-gl.css";

type Pt = {
  key: string; label: string; type: string; confidence: number;
  lat: number; lng: number; geo_source: string; evidence_id: number | null; evidence_file: string;
};
type Trail = { location: string; lat: number; lng: number; date: string | null; snippet: string }[];

// Carto dark-matter basemap (no key; fits the command-center theme).
const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Geo-spatial intelligence: located entities, hotspots, person movements. */
export function GeoMap({ caseId }: { caseId: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);
  const [points, setPoints] = useState<Pt[]>([]);
  const [unlocated, setUnlocated] = useState<{ key: string; label: string }[]>([]);
  const [hotspots, setHotspots] = useState<{ lat: number; lng: number; count: number; members: string[] }[]>([]);
  const [persons, setPersons] = useState<string[]>([]);
  const [who, setWho] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.geoPoints(caseId).then((d) => {
      setPoints(d.points ?? []);
      setUnlocated(d.unlocated ?? []);
      setHotspots(d.hotspots ?? []);
    }).catch((e) => setError(e instanceof Error ? e.message : "Geo load failed"));
    api.caseGraph(caseId).then((g) => {
      setPersons((g.nodes ?? []).filter((n: { type: string }) => n.type === "Person").map((n: { id: string }) => n.id));
    }).catch(() => {});
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mountRef.current || points.length === 0) return;
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !mountRef.current) return;
        // Tear down the previous map first: a leaked map keeps its render
        // loop alive against a reused container.
        try {
          mapRef.current?.remove();
        } catch {
          /* already gone */
        }
        mapRef.current = null;
        if (cancelled || !mountRef.current) return;
        const map = new maplibre.Map({
          container: mountRef.current,
          style: STYLE,
          center: [points[0].lng, points[0].lat],
          zoom: 6,
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl(), "top-right");
        for (const p of points) {
          const el = document.createElement("div");
          el.style.cssText = `width:12px;height:12px;border-radius:50%;background:#38bdf8;border:2px solid #0a0f1e;cursor:pointer;`;
          el.title = `${p.label} (${(p.confidence * 100).toFixed(0)}% via ${p.geo_source})`;
          new maplibre.Marker({ element: el }).setLngLat([p.lng, p.lat])
            .setPopup(new maplibre.Popup().setHTML(
              `<b>${p.label}</b><br/>${p.evidence_file || "no source file"}`))
            .addTo(map);
        }
        for (const h of hotspots) {
          const el = document.createElement("div");
          el.style.cssText = `width:${14 + h.count * 6}px;height:${14 + h.count * 6}px;border-radius:50%;background:rgba(239,68,68,.35);border:2px solid #ef4444;cursor:pointer;`;
          el.title = `Hotspot: ${h.count} entities (${h.members.join(", ")})`;
          new maplibre.Marker({ element: el }).setLngLat([h.lng, h.lat]).addTo(map);
        }
      } catch {
        setError("Map failed to load (basemap unreachable offline?)");
      }
    })();
    return () => {
      cancelled = true;
      const map = mapRef.current;
      mapRef.current = null;
      try {
        map?.remove();
      } catch {
        /* already gone */
      }
    };
  }, [points, hotspots]);

  async function showMovement(person: string) {
    setWho(person);
    if (!person) return;
    try {
      const d = await api.geoMovements(caseId, person);
      const trail: Trail = d.trail ?? [];
      const map = mapRef.current as unknown as {
        getSource(id: string): unknown; addSource(id: string, src: unknown): void;
        getLayer(id: string): unknown; addLayer(l: unknown): void; removeLayer(id: string): void; removeSource(id: string): void;
      } | null;
      if (!map || trail.length < 1) return;
      const coords = trail.map((t) => [t.lng, t.lat]);
      if (map.getLayer("movement")) {
        map.removeLayer("movement");
        map.removeSource("movement");
      }
      map.addSource("movement", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} } });
      map.addLayer({ id: "movement", type: "line", source: "movement", paint: { "line-color": "#f59e0b", "line-width": 3 } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Movement load failed");
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Geo-spatial ({points.length} located{unlocated.length ? ` · ${unlocated.length} unlocated` : ""})</h2>
        <select className="input !w-auto !py-1 text-xs" value={who} onChange={(e) => showMovement(e.target.value)}>
          <option value="">Movement trail: select person…</option>
          {persons.map((p) => <option key={p} value={p}>{p.split(":").slice(-1)}</option>)}
        </select>
      </div>
      {error && <p className="mt-1 text-sm text-risk-high">{error}</p>}
      {points.length > 0 ? (
        <div ref={mountRef} className="mt-2 h-[300px] rounded-lg border border-ink-700 md:h-[380px]" />
      ) : (
        <p className="mt-2 text-sm text-slate-500">No located entities yet — known places auto-pin at extraction; pin the rest from review.</p>
      )}
      {unlocated.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">Unlocated: {unlocated.map((u) => u.label).join(", ")}</p>
      )}
    </div>
  );
}
