"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, Download, MapPin, Play, Pause } from "lucide-react";
import { Panel } from "../ui/Panel";
import { TableSkeleton } from "../ui/Table";
import { Tag } from "../ui/Tag";
import { Empty } from "../ui/Empty";
import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Input, SearchInput } from "../ui/Input";
import { Avatar } from "../ui/Avatar";
import { useToast } from "../ui/Toast";
import {
  mapPoints, mapMovements, mapNearby, locateEntity, generatePackage, reviewEntities, reviewRelations, confirmEntity, rejectEntity, caseTimeline,
  type MapDevicePing, type MapPoints, type MapSuspect, type MapTower, type NearbyHit, type TrailPoint,
} from "@/lib/endpoints";
import { EntityDetailPanel, type EntityRow, type RelCardData } from "./EntityDetailPanel";
import type { TimelineEvent } from "@/lib/types";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLES: Record<string, string> = {
  "Map View": "https://tiles.openfreemap.org/styles/liberty",
  Bright: "https://tiles.openfreemap.org/styles/bright",
  Positron: "https://tiles.openfreemap.org/styles/positron",
};

const SUSPECT_COLOR = "#f87171";
const DEVICE_COLOR = "#00d9ff";
const TOWER_COLOR = "#4ade80";

interface Pin {
  layer: "suspect" | "device" | "tower";
  entity_id: number | null;
  key: string;
  label: string;
  sub: string;
  detail: string;
}

function suspectPin(s: MapSuspect): Pin {
  return {
    layer: "suspect",
    entity_id: s.entity_id,
    key: s.key,
    label: s.value,
    sub: `Last seen ${s.date ?? "date unknown"} · ${s.place}`,
    detail: `${Math.round(s.confidence * 100)}% · ${s.evidence_file || "no file"}`,
  };
}

function devicePin(d: MapDevicePing): Pin {
  return {
    layer: "device",
    entity_id: d.entity_id,
    key: d.key,
    label: d.value,
    sub: `Observed in ${d.evidence_file || "unknown file"}`,
    detail: `${Math.round(d.confidence * 100)}% · ${d.geo_source || "unverified position"}`,
  };
}

function towerPin(t: MapTower): Pin {
  return {
    layer: "tower",
    entity_id: null,
    key: t.key,
    label: t.tower,
    sub: `${t.date ? `Seen ${t.date}` : "Date unknown"} · ${t.count} row${t.count === 1 ? "" : "s"}`,
    detail: `${t.evidence_file || "unknown file"} · ${t.source}`,
  };
}

function Toggle({ on, disabled, reason, onChange, label }: {
  on: boolean;
  disabled?: boolean;
  reason?: string;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={disabled && reason ? reason : undefined}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors duration-120 ${
        on ? "border-cyan-br bg-cyan-bg" : "border-line-2 bg-panel-3"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        aria-hidden
        className={`absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all duration-120 ${
          on ? "left-[16px] bg-cyan" : "left-[2px] bg-fg-4"
        }`}
      />
    </button>
  );
}

export function MapTab({ caseId: cid, sho, canVerify, canEdit }: {
  caseId: string | number;
  sho: boolean;
  canVerify: boolean;
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<MapPoints | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSuspects, setShowSuspects] = useState(true);
  const [showDevices, setShowDevices] = useState(true);
  const [showTowers, setShowTowers] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [showBuildings3d, setShowBuildings3d] = useState(false);
  const [buildingsAvail, setBuildingsAvail] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minConf, setMinConf] = useState(0);
  const [sideTab, setSideTab] = useState<"layers" | "filters">("layers");
  const [selected, setSelected] = useState<Pin | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [relations, setRelations] = useState<RelCardData[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [styleName, setStyleName] = useState("Map View");
  const [searchQ, setSearchQ] = useState("");
  const [searchMark, setSearchMark] = useState<{ lng: number; lat: number; label: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [tileError, setTileError] = useState("");
  const [tileWarn, setTileWarn] = useState("");
  const [baseLabel, setBaseLabel] = useState("");
  const [tileRetry, setTileRetry] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [moveMark, setMoveMark] = useState<{ entity_id: number; lng: number; lat: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [captureSignal, setCaptureSignal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [center, setCenter] = useState<{ lng: number; lat: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(5);
  const [hits, setHits] = useState<NearbyHit[]>([]);
  const [nbLoading, setNbLoading] = useState(false);
  const [nbSearched, setNbSearched] = useState(false);
  const [focusPt, setFocusPt] = useState<{ lng: number; lat: number; n: number } | null>(null);
  const [trail, setTrail] = useState<TrailPoint[] | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailName, setTrailName] = useState("");
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [area, setArea] = useState<DrawArea | null>(null);
  const [areaCount, setAreaCount] = useState(0);
  const [showArea, setShowArea] = useState(true);
  const [clearSignal, setClearSignal] = useState(0);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      mapPoints(cid),
      reviewEntities(cid, "", 500).catch(() => ({ results: [] as EntityRow[] })),
      reviewRelations(cid, "", 500).catch(() => ({ results: [] as never[] })),
      caseTimeline(cid).catch(() => ({ events: [] })),
    ])
      .then(([mp, ents, rels, tl]) => {
        setData(mp);
        const rows = ((ents as { results?: EntityRow[] }).results ?? []) as EntityRow[];
        setEntities(rows);
        const byId = new Map(rows.map((e) => [Number(e.id), e]));
        setRelations(
          ((rels as { results?: never[] }).results ?? []).map((r) => {
            const x = r as unknown as {
              id: number; src: number; dst: number; src_value: string; dst_value: string;
              edge_type: string; confidence: number; snippet: string;
            };
            const sid = Number(x.src);
            const did = Number(x.dst);
            const other = byId.get(did) ?? byId.get(sid);
            const otherId = byId.get(did) ? did : sid;
            return {
              id: x.id, srcId: sid, dstId: did, otherId,
              other: other?.value ?? (otherId === sid ? x.src_value : x.dst_value),
              otherType: other?.node_type, edge: x.edge_type,
              confidence: x.confidence, snippet: x.snippet,
            } as RelCardData;
          })
        );
        setEvents((((tl as { events?: TimelineEvent[] }).events ?? []) as TimelineEvent[]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [cid]);

  // Trail follows suspect selection: device/tower pins have no trails.
  const trailKey = selected?.layer === "suspect" && selected.entity_id != null
    ? `${selected.entity_id}:${selected.label}`
    : "";
  useEffect(() => {
    setPlaying(false);
    setFrameIdx(0);
    if (!trailKey) {
      setTrail(null);
      setTrailName("");
      return;
    }
    const eid = Number(trailKey.split(":")[0]);
    setTrailLoading(true);
    setTrailName(selected?.label ?? "");
    mapMovements(cid, eid)
      .then((d) => setTrail(d.trail ?? []))
      .catch(() => setTrail([]))
      .finally(() => setTrailLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailKey, cid]);

  // Playback clock: chained timeouts (StrictMode-safe — no setState
  // inside updaters). Stops itself after the last dated point.
  useEffect(() => {
    if (!playing || !trail || trail.length < 2) return;
    if (frameIdx >= trail.length - 1) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setFrameIdx(frameIdx + 1), Math.round(1200 / speed));
    return () => clearTimeout(id);
  }, [playing, speed, trail, frameIdx]);

  function playTrail() {
    if (!trail || trail.length < 2) return;
    if (frameIdx >= trail.length - 1) setFrameIdx(0);
    setPlaying(true);
  }

  const suspects = useMemo(() => {
    const rows = data?.suspects ?? [];
    return rows.filter((s) => {
      if (s.confidence < minConf) return false;
      // Undated presences always pass date filters: absence of a date is
      // not evidence of irrelevance (same rule as the graph reads).
      if (!s.date) return true;
      if (dateFrom && s.date < dateFrom) return false;
      if (dateTo && s.date > dateTo) return false;
      return true;
    });
  }, [data, dateFrom, dateTo, minConf]);

  const devices = useMemo(
    () => (data?.device_pings ?? []).filter((d) => d.confidence >= minConf),
    [data, minConf]
  );

  const towers = useMemo(() => {
    const rows = data?.towers ?? [];
    return rows.filter((t) => {
      if (!t.date) return true;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      return true;
    });
  }, [data, dateFrom, dateTo]);

  const pins = useMemo(
    () => [
      ...(showSuspects ? suspects.map(suspectPin) : []),
      ...(showDevices ? devices.map(devicePin) : []),
      ...(showTowers ? towers.map(towerPin) : []),
    ],
    [suspects, devices, towers, showSuspects, showDevices, showTowers]
  );

  const coords = useMemo(() => {
    const m = new Map<string, { lng: number; lat: number; conf: number }>();
    for (const s of suspects) m.set(s.key, { lng: s.lng, lat: s.lat, conf: s.confidence });
    for (const d of devices) m.set(d.key, { lng: d.lng, lat: d.lat, conf: d.confidence });
    for (const t of towers) m.set(t.key, { lng: t.lng, lat: t.lat, conf: 0.7 });
    return m;
  }, [suspects, devices, towers]);

  const drawerEntity = entities.find((e) => Number(e.id) === drawerId) ?? null;
  const drawerRels = drawerEntity
    ? relations.filter((r) => {
        const x = r as RelCardData & { srcId: number; dstId: number };
        return x.srcId === Number(drawerEntity.id) || x.dstId === Number(drawerEntity.id);
      })
    : [];
  const drawerEvents = drawerEntity
    ? events.filter((e) =>
        `${e.title ?? ""} ${e.from ?? ""} ${e.to ?? ""}`
          .toLowerCase()
          .includes(drawerEntity.value.toLowerCase()))
    : [];

  async function decide(ok: boolean) {
    if (!drawerEntity) return;
    try {
      if (ok) await confirmEntity(cid, drawerEntity.id);
      else await rejectEntity(cid, drawerEntity.id);
      toast({ kind: "ok", title: ok ? "Confirmed" : "Rejected", body: drawerEntity.value });
      reviewEntities(cid, "", 500)
        .then((d) => setEntities((d.results ?? []) as unknown as EntityRow[]))
        .catch(() => {});
    } catch (err) {
      toast({ kind: "warn", title: "Decision failed", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function runNearby(at?: { lng: number; lat: number }) {
    const c = at ?? center;
    if (!c || nbLoading) return;
    const r = Math.max(0.1, Number(radiusKm) || 5);
    setNbLoading(true);
    try {
      const res = await mapNearby(cid, {
        lat: c.lat, lng: c.lng, radius_km: r,
        date_from: dateFrom || undefined, date_to: dateTo || undefined,
      });
      setHits(res.hits ?? []);
      setNbSearched(true);
    } catch (err) {
      toast({ kind: "warn", title: "Nearby search failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      setNbLoading(false);
    }
  }

  function clearNearby() {
    setPicking(false);
    setCenter(null);
    setHits([]);
    setNbSearched(false);
  }

  async function saveMove(lng: number, lat: number) {
    if (!moveMark || moving) return;
    setMoving(true);
    try {
      await locateEntity(cid, moveMark.entity_id, lat, lng);
      toast({ kind: "ok", title: "Pin corrected", body: `${lat.toFixed(4)}, ${lng.toFixed(4)} · saved as manual` });
      setMoveMark(null);
      setSelected(null);
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Correction failed", body: err instanceof Error ? err.message : undefined });
      setMoveMark(null);
      refresh();
    } finally {
      setMoving(false);
    }
  }

  // Esc cancels a pending pin move.
  useEffect(() => {
    if (!moveMark) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoveMark(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveMark]);

  async function exportView() {
    if (exporting) return;
    setExporting(true);
    setCaptureSignal((n) => n + 1);
  }

  async function onCapture(blob: Blob | null) {
    if (!blob || blob.size === 0) {
      setExporting(false);
      toast({ kind: "warn", title: "Capture failed", body: "The map canvas could not be read — try again." });
      return;
    }
    try {
      const label = `Map view ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
      const pkg = await generatePackage(cid, { blob, label });
      toast({ kind: "ok", title: "Map exhibit packaged", body: "Snapshot embedded in the court-ready PDF." });
      if (pkg.download_url) window.open(pkg.download_url, "_blank", "noopener");
      refresh();
    } catch (err) {
      toast({ kind: "warn", title: "Export failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  async function search(q: string) {
    const needle = q.trim();
    if (!needle || searching) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(needle)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`search ${res.status}`);
      const hits = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
      if (!hits.length || hits[0].lat == null || hits[0].lon == null) {
        toast({ kind: "warn", title: "No match", body: needle });
        return;
      }
      setSearchMark({ lng: Number(hits[0].lon), lat: Number(hits[0].lat), label: hits[0].display_name ?? needle });
    } catch (err) {
      toast({ kind: "warn", title: "Search failed", body: err instanceof Error ? err.message : undefined });
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-[18px]">
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-[18px] max-[1100px]:grid-cols-1">
        <div className="relative min-h-[560px] overflow-hidden rounded-md border border-line bg-bg">
          <MapCanvas
            pins={pins}
            coords={coords}
            styleUrl={STYLES[styleName]}
            selectedKey={selected?.key ?? null}
            searchMark={searchMark}
            fitSignal={fitSignal}
            drawActive={drawing}
            showArea={showArea}
            showHeat={showHeat}
            buildings3d={showBuildings3d}
            trail={trail}
            frameIdx={frameIdx}
            onBuildingsUnavailable={() => {
              setBuildingsAvail(false);
              setShowBuildings3d(false);
            }}
            onBuildingsAvailable={() => {
              setBuildingsAvail(true);
            }}
            areaRing={area?.ring ?? null}
            clearSignal={clearSignal}
            onPinClick={setSelected}
            moveMark={moveMark}
            onMoveEnd={(lng, lat) => saveMove(lng, lat)}
            captureSignal={captureSignal}
            onCapture={onCapture}
            picking={picking}
            center={center}
            radiusKm={Math.max(0.1, Number(radiusKm) || 5)}
            hits={hits}
            focusPt={focusPt}
            onPickCenter={(c) => {
              setCenter(c);
              setPicking(false);
              runNearby(c);
            }}
            onViewDetails={(id) => setDrawerId(id)}
            onAreaFinish={(ring, insideKeys) => {
              setDrawing(false);
              setArea({ ring, insideKeys });
              setAreaCount(insideKeys.length);
              setShowArea(true);
            }}
            onIsolate={(keys) => {
              router.push(`/cases/${cid}?tab=network&isolate=${encodeURIComponent(keys.join(","))}`);
            }}
            onTileError={(msg) => setTileError(msg)}
            onTileOk={() => {
              setTileError("");
              setTileWarn("");
            }}
            onTileWarn={(msg) => setTileWarn(msg)}
            onStyleLabel={(label) => setBaseLabel(label)}
            tileRetrySignal={tileRetry}
          />
          <form
            className="absolute left-3 top-3 z-10 w-full max-w-[300px]"
            onSubmit={(e) => {
              e.preventDefault();
              search(searchQ);
            }}
          >
            <SearchInput
              placeholder="Search location, address…"
              aria-label="Search location"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </form>
          <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 gap-[6px]">
            <Button
              variant={drawing ? "primary" : "ghost"} small
              onClick={() => {
                if (drawing) setDrawing(false);
                else {
                  setArea(null);
                  setAreaCount(0);
                  setClearSignal((n) => n + 1);
                  setDrawing(true);
                }
              }}
              title={drawing ? "Stop drawing (Escape also cancels)" : "Draw a polygon; entities inside can isolate in Network Graph"}
            >
              Draw Area
            </Button>
            <Button
              variant="ghost" small
              disabled={!drawing && !area}
              onClick={() => {
                setDrawing(false);
                setArea(null);
                setAreaCount(0);
                setClearSignal((n) => n + 1);
              }}
              title="Clears the drawn area"
            >
              Clear
            </Button>
            <Button
              variant={showBuildings3d ? "primary" : "ghost"} small
              disabled={!buildingsAvail}
              onClick={() => setShowBuildings3d((v) => !v)}
              title={buildingsAvail ? "Toggle OSM 3D building extrusions" : "3D buildings need a vector-tile building source"}
            >
              3D Buildings
            </Button>
            <select
              aria-label="Map style"
              value={styleName}
              onChange={(e) => {
                // A style reload drops Terra Draw's sketch mid-draw; stop
                // drawing first (the completed area copy re-renders itself).
                setDrawing(false);
                setStyleName(e.target.value);
              }}
              className="h-[26px] rounded border border-line bg-panel-2 px-2 font-mono text-[11px] text-fg-2"
            >
              {Object.keys(STYLES).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {tileWarn && !tileError ? (
            <div className="absolute inset-x-3 top-12 z-10 flex items-center gap-2 rounded-md border border-amber-500/30 bg-[#1a1407]/95 px-3 py-2">
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
                  setTileRetry((n) => n + 1);
                }}
                className="shrink-0 rounded border border-line-2 px-2 py-0.5 font-mono text-[10.5px] text-fg-2 hover:border-cyan hover:text-fg"
              >
                Retry
              </button>
            </div>
          ) : null}
          {!tileWarn && !tileError && baseLabel ? (
            <div className="absolute right-3 top-12 z-10 rounded border border-line bg-panel/90 px-2 py-1 font-mono text-[10px] text-fg-4">
              {baseLabel}
            </div>
          ) : null}
          {tileError ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg p-6">
              <Empty icon={MapPin} title="Map unavailable" body={tileError} />
              <div className="absolute bottom-6">
                <Button
                  variant="ghost"
                  small
                  onClick={() => {
                    setTileError("");
                    setTileRetry((n) => n + 1);
                  }}
                >
                  Retry map
                </Button>
              </div>
            </div>
          ) : null}
          <div className="absolute inset-x-0 bottom-0 z-10 border-t border-line bg-panel px-[14px] py-[9px]">
            <p className="flex items-center justify-between gap-2">
              <span className="micro-label">
                Movement Timeline{trailName ? ` · ${trailName}` : ""}
              </span>
              <span className="font-mono text-[10px] text-fg-4">
                {trail && trail.length >= 2
                  ? `${trail[0].date} → ${trail[trail.length - 1].date}`
                  : "dated trails only"}
              </span>
            </p>
            {!selected || selected.layer !== "suspect" ? (
              <p className="mt-2 font-mono text-[11px] text-fg-4">
                Select a suspect pin to play its dated trail.
              </p>
            ) : trailLoading ? (
              <p className="mt-2 font-mono text-[11px] text-fg-4">Loading trail…</p>
            ) : !trail || trail.length < 2 ? (
              <p className="mt-2 font-mono text-[11px] text-fg-4">
                {(trail?.length ?? 0) === 0
                  ? "No dated sightings for this suspect — a trail needs dated locations."
                  : "Only 1 dated sighting — a trail needs at least two dated locations."}
              </p>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                {playing ? (
                  <Button variant="ghost" small onClick={() => setPlaying(false)} title="Pause">
                    <Pause size={13} strokeWidth={1.6} aria-hidden />
                  </Button>
                ) : (
                  <Button variant="ghost" small onClick={playTrail} title={frameIdx >= trail.length - 1 ? "Replay from start" : "Play"}>
                    <Play size={13} strokeWidth={1.6} aria-hidden />
                  </Button>
                )}
                <input
                  type="range" min={0} max={trail.length - 1} value={frameIdx}
                  onChange={(e) => {
                    setFrameIdx(Number(e.target.value));
                    setPlaying(false);
                  }}
                  aria-label="Trail scrubber"
                  className="h-1 flex-1"
                />
                <span className="min-w-[86px] text-right font-mono text-[10.5px] text-fg-2">
                  {trail[frameIdx]?.date} · {frameIdx + 1}/{trail.length}
                </span>
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="h-[26px] rounded border border-line bg-panel-2 px-1 font-mono text-[11px] text-fg-2"
                >
                  {[0.5, 1, 2, 4].map((s) => (
                    <option key={s} value={s}>{s}x</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {selected ? (
            <div className="absolute bottom-[86px] right-3 z-10 w-[260px] rounded-md border border-line bg-panel p-[12px]">
              <p className="micro-label">Selected Entity</p>
              <p className="mt-[6px] flex items-center gap-2">
                <Avatar name={selected.label} />
                <b className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{selected.label}</b>
                <Tag tone={selected.layer === "suspect" ? "red" : selected.layer === "device" ? "cyan" : "green"}>
                  {selected.layer === "suspect" ? "Suspect" : selected.layer === "device" ? "Device" : "Tower"}
                </Tag>
              </p>
              <p className="mt-[4px] truncate text-[12px] text-fg-2">{selected.sub}</p>
              <p className="mt-[2px] font-mono text-[10.5px] text-fg-4">{selected.detail}</p>
              {moveMark ? (
                <p className="mt-2 font-mono text-[10.5px] leading-[1.6] text-fg-3">
                  Drag the violet marker, release to save. Esc cancels.
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                {selected.entity_id != null ? (
                  <Button variant="primary" small className="flex-1" onClick={() => setDrawerId(selected.entity_id)}>
                    View Details
                  </Button>
                ) : (
                  <p className="flex-1 font-mono text-[10.5px] text-fg-4">
                    Tower points carry no entity record to open.
                  </p>
                )}
                {selected.layer === "device" && selected.entity_id != null && canEdit && !moveMark ? (
                  <Button
                    variant="ghost" small
                    onClick={() => {
                      const at = coords.get(selected.key);
                      if (!at) return;
                      setMoveMark({ entity_id: selected.entity_id as number, lng: at.lng, lat: at.lat });
                    }}
                    title="Drag the pin to correct this place's coordinates"
                  >
                    Move pin
                  </Button>
                ) : null}
                {moveMark ? (
                  <Button variant="ghost" small onClick={() => setMoveMark(null)}>
                    Cancel
                  </Button>
                ) : (
                  <Button variant="ghost" small onClick={() => setSelected(null)}>
                    Close
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-[18px]">
          <Panel
            title={
              <span className="flex gap-3">
                {(["layers", "filters"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSideTab(t)}
                    className={`capitalize transition-colors duration-120 ${sideTab === t ? "text-fg" : "text-fg-4 hover:text-fg-2"}`}
                  >
                    {t}
                  </button>
                ))}
              </span>
            }
          >
            {sideTab === "layers" ? (
              <ul className="divide-y divide-line">
                <LayerRow
                  label="Suspects" color={SUSPECT_COLOR} count={suspects.length}
                  on={showSuspects} onChange={setShowSuspects}
                />
                <LayerRow
                  label="Device Location Pings" color={DEVICE_COLOR} count={devices.length}
                  on={showDevices} onChange={setShowDevices}
                  hint="Located places observed in CDR evidence"
                />
                <LayerRow
                  label="Cell Tower Pings" color={TOWER_COLOR} count={towers.length}
                  on={showTowers} onChange={setShowTowers}
                  hint="Parsed from CDR tower columns"
                />
                <LayerRow
                  label="Hotspots (Density)" color="#fbbf24" count={pins.length}
                  on={showHeat} onChange={setShowHeat}
                  hint="Live density of plotted pins"
                />
                <LayerRow
                  label="3D Buildings (OSM)" color="#8b95a3" countLabel="tile"
                  on={showBuildings3d} onChange={setShowBuildings3d}
                  disabled={!buildingsAvail}
                  reason={!buildingsAvail ? "No building source in this map style" : undefined}
                  hint="OSM footprints · 12 m default where untagged"
                />
                <LayerRow
                  label="Selected Area" color="#a78bfa" count={area ? areaCount : 0}
                  on={showArea} onChange={setShowArea}
                  disabled={!area} reason={!area ? "Draw an area first" : undefined}
                  hint={area ? `${areaCount} ${areaCount === 1 ? "entity" : "entities"} inside` : undefined}
                />
              </ul>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="micro-label mb-[6px] block" htmlFor="map-from">Seen from</label>
                  <Input id="map-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <label className="micro-label mb-[6px] block" htmlFor="map-to">Seen to</label>
                  <Input id="map-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div>
                  <label className="micro-label mb-[6px] block" htmlFor="map-conf">
                    Min confidence · {minConf}%
                  </label>
                  <input
                    id="map-conf" type="range" min={0} max={100} value={Math.round(minConf * 100)}
                    onChange={(e) => setMinConf(Number(e.target.value) / 100)}
                    className="h-1 w-full" aria-label="Minimum confidence"
                  />
                </div>
                <p className="font-mono text-[10.5px] leading-[1.6] text-fg-4">
                  Dates filter suspect sightings and tower mentions (undated
                  ones always pass); device pings carry no dates. Confidence
                  filters all layers, including the heatmap.
                </p>
                {(dateFrom || dateTo || minConf > 0) && (
                  <Button variant="ghost" small onClick={() => { setDateFrom(""); setDateTo(""); setMinConf(0); }}>
                    Clear filters
                  </Button>
                )}
                <div className="border-t border-line pt-3">
                  <p className="micro-label mb-[8px]">Nearby search</p>
                  <p className="mb-[8px] font-mono text-[10.5px] leading-[1.6] text-fg-4">
                    {center
                      ? `Center ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`
                      : "Pick a center on the map, then search."}
                  </p>
                  <div className="flex flex-wrap items-center gap-[8px]">
                    <Button
                      variant={picking ? "primary" : "ghost"} small
                      onClick={() => setPicking((v) => !v)}
                      title="Click the map to drop the search center"
                    >
                      {picking ? "Picking… click map" : "Pick center"}
                    </Button>
                    <label className="flex items-center gap-[6px] font-mono text-[11px] text-fg-3">
                      Radius
                      <input
                        type="number" min={0.1} step={0.5} value={radiusKm}
                        onChange={(e) => setRadiusKm(Number(e.target.value))}
                        aria-label="Radius in km"
                        className="h-[26px] w-[64px] rounded border border-line-2 bg-panel-2 px-2 font-mono text-[11px] text-fg"
                      />
                      km
                    </label>
                    <Button variant="primary" small disabled={!center || nbLoading} onClick={() => runNearby()}>
                      {nbLoading ? "Searching…" : "Search"}
                    </Button>
                    {(center || hits.length > 0) && (
                      <Button variant="ghost" small onClick={clearNearby}>
                        Clear
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-[10.5px] leading-[1.6] text-fg-4">
                    Uses the date window above; undated sightings always match.
                  </p>
                  {nbSearched && (
                    <ul className="mt-2 divide-y divide-line">
                      {hits.length === 0 ? (
                        <li className="py-[8px] text-[12.5px] text-fg-3">
                          Nobody plotted within range — try a wider radius or window.
                        </li>
                      ) : (
                        hits.map((h) => (
                          <li key={`${h.entity_id}-${h.location}-${h.date ?? "undated"}`}>
                            <button
                              type="button"
                              onClick={() => setFocusPt({ lng: h.lng, lat: h.lat, n: Date.now() })}
                              className="block w-full py-[8px] text-left"
                              title="Fly to this sighting"
                            >
                              <b className="block truncate text-[12.5px] font-medium text-fg">{h.person}</b>
                              <span className="block truncate font-mono text-[10.5px] text-fg-4">
                                {h.location} · {h.dist_km} km · {h.date ?? "date unknown"}
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {(data?.unlocated.length ?? 0) > 0 && (
              <p className="mt-3 border-t border-line pt-2 font-mono text-[10.5px] text-fg-4">
                {data?.unlocated.length} place{data && data.unlocated.length === 1 ? "" : "s"} without
                coordinates — confirm a location to pin {data && data.unlocated.length === 1 ? "it" : "them"}.
              </p>
            )}
          </Panel>

          <Panel title="Quick Actions">
            <div className="space-y-2">
              <Button variant="ghost" small className="w-full" onClick={() => setFitSignal((n) => n + 1)}>
                <Crosshair size={13} strokeWidth={1.6} aria-hidden /> Fit to Case Locations
              </Button>
              <Button
                variant="ghost" small className="w-full"
                disabled={!canEdit || exporting}
                onClick={exportView}
                title={canEdit
                  ? "Capture this view and embed it in a new court-ready package"
                  : "Generating packages needs edit permission on this case"}
              >
                <Download size={13} strokeWidth={1.6} aria-hidden />{" "}
                {exporting ? "Exporting…" : "Export Map View"}
              </Button>
            </div>
          </Panel>
        </div>
      </div>

      {loading ? <TableSkeleton rows={2} /> : null}

      {drawerId != null && (
        <div className="fixed inset-y-0 right-0 z-40 w-[380px] max-w-[92vw] overflow-y-auto border-l border-line bg-panel-2 shadow-xl" role="dialog" aria-label="Entity details">
          <div className="flex justify-end p-2">
            <Button variant="ghost" small onClick={() => setDrawerId(null)}>
              Close
            </Button>
          </div>
          <EntityDetailPanel
            entity={drawerEntity}
            relations={drawerRels}
            events={drawerEvents}
            canVerify={canVerify && !sho}
            onConfirm={() => decide(true)}
            onReject={() => decide(false)}
            onSelect={(id) => {
              const n = Number(id);
              if (entities.some((e) => Number(e.id) === n)) setDrawerId(n);
            }}
          />
        </div>
      )}
    </div>
  );
}

function LayerRow({ label, color, count, countLabel, on, onChange, disabled, reason, hint }: {
  label: string;
  color: string;
  count?: number;
  countLabel?: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  reason?: string;
  hint?: string;
}) {
  return (
    <li className="flex items-center gap-[10px] py-[9px]" title={disabled && reason ? reason : hint}>
      <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12.5px] ${disabled ? "text-fg-4" : "text-fg"}`}>{label}</span>
        {disabled && reason ? (
          <span className="block truncate font-mono text-[10px] text-fg-4">{reason}</span>
        ) : hint ? (
          <span className="block truncate font-mono text-[10px] text-fg-4">{hint}</span>
        ) : null}
      </span>
      <span className="font-mono text-[11px] text-fg-3">{countLabel ?? count}</span>
      <Toggle on={on} disabled={disabled} reason={reason} onChange={onChange} label={label} />
    </li>
  );
}

export interface DrawArea {
  ring: number[][][];
  insideKeys: string[];
}

function MapCanvas({ pins, coords, styleUrl, selectedKey, searchMark, fitSignal, drawActive, showArea, showHeat, buildings3d, trail, frameIdx, picking, center, radiusKm, hits, focusPt, moveMark, captureSignal, areaRing, clearSignal, tileRetrySignal = 0, onPinClick, onViewDetails, onAreaFinish, onIsolate, onPickCenter, onMoveEnd, onCapture, onTileError, onTileOk, onTileWarn, onStyleLabel, onBuildingsUnavailable, onBuildingsAvailable }: {
  pins: Pin[];
  coords: Map<string, { lng: number; lat: number; conf: number }>;
  styleUrl: string;
  selectedKey: string | null;
  searchMark: { lng: number; lat: number; label: string } | null;
  fitSignal: number;
  drawActive: boolean;
  showArea: boolean;
  showHeat: boolean;
  areaRing: number[][][] | null;
  clearSignal: number;
  onPinClick: (pin: Pin) => void;
  onViewDetails: (entity_id: number) => void;
  onAreaFinish: (ring: number[][][], insideKeys: string[]) => void;
  onIsolate: (keys: string[]) => void;
  onTileError: (msg: string) => void;
  onTileOk: () => void;
  onTileWarn?: (msg: string) => void;
  onStyleLabel?: (label: string) => void;
  tileRetrySignal?: number;
  buildings3d: boolean;
  onBuildingsUnavailable: () => void;
  onBuildingsAvailable?: () => void;
  trail: TrailPoint[] | null;
  frameIdx: number;
  picking: boolean;
  center: { lng: number; lat: number } | null;
  radiusKm: number;
  hits: NearbyHit[];
  focusPt: { lng: number; lat: number; n: number } | null;
  onPickCenter: (c: { lng: number; lat: number }) => void;
  moveMark: { entity_id: number; lng: number; lat: number } | null;
  onMoveEnd: (lng: number, lat: number) => void;
  captureSignal: number;
  onCapture: (blob: Blob | null) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const drawRef = useRef<{ draw: import("terra-draw").TerraDraw } | null>(null);
  const liveRef = useRef<{
    pins: Pin[];
    coords: Map<string, { lng: number; lat: number; conf: number }>;
    selectedKey: string | null;
    searchMark: { lng: number; lat: number; label: string } | null;
    showArea: boolean;
    showHeat: boolean;
    buildings3d: boolean;
    trail: TrailPoint[] | null;
    frameIdx: number;
    picking: boolean;
    center: { lng: number; lat: number } | null;
    radiusKm: number;
    hits: NearbyHit[];
    focusPt: { lng: number; lat: number; n: number } | null;
    moveMark: { entity_id: number; lng: number; lat: number } | null;
    captureSignal: number;
    areaRing: number[][][] | null;
    onPinClick: (pin: Pin) => void;
    onViewDetails: (entity_id: number) => void;
    onAreaFinish: (ring: number[][][], insideKeys: string[]) => void;
    onIsolate: (keys: string[]) => void;
    onPickCenter: (c: { lng: number; lat: number }) => void;
    onMoveEnd: (lng: number, lat: number) => void;
    onCapture: (blob: Blob | null) => void;
    onTileError: (msg: string) => void;
    onTileOk: () => void;
    onTileWarn?: (msg: string) => void;
    onStyleLabel?: (label: string) => void;
    onBuildingsUnavailable: () => void;
    onBuildingsAvailable?: () => void;
    styleUrl: string;
  }>({ pins, coords, selectedKey, searchMark, showArea, showHeat, buildings3d, trail, frameIdx, picking, center, radiusKm, hits, focusPt, moveMark, captureSignal, areaRing, onPinClick, onViewDetails, onAreaFinish, onIsolate, onPickCenter, onMoveEnd, onCapture, onTileError, onTileOk, onTileWarn, onStyleLabel, onBuildingsUnavailable, onBuildingsAvailable, styleUrl });
  liveRef.current = { pins, coords, selectedKey, searchMark, showArea, showHeat, buildings3d, trail, frameIdx, picking, center, radiusKm, hits, focusPt, moveMark, captureSignal, areaRing, onPinClick, onViewDetails, onAreaFinish, onIsolate, onPickCenter, onMoveEnd, onCapture, onTileError, onTileOk, onTileWarn, onStyleLabel, onBuildingsUnavailable, onBuildingsAvailable, styleUrl };
  const fittedRef = useRef(false);
  const popupRef = useRef<import("maplibre-gl").Popup | null>(null);
  // Generation guard: only the latest background upgrade may touch the map.
  const upgradeGen = useRef(0);
  // Set once the offline base is mounted; upgrades wait on it.
  const mountedRef = useRef(false);
  // Stable click handler: setupLayers() re-runs on every style reload, and
  // off() only removes the exact reference — a fresh closure per call would
  // stack duplicate popups.
  const clickRef = useRef<((e: import("maplibre-gl").MapMouseEvent & {
    features?: import("maplibre-gl").MapGeoJSONFeature[];
  }) => void) | null>(null);
  // Stable map-level click: drops the Nearby center when picking (pin
  // clicks fall through to the same point — predictable, documented).
  // Typed exactly like the pin handler so no casts are needed at bind time.
  const pickRef = useRef<((e: import("maplibre-gl").MapMouseEvent & {
    features?: import("maplibre-gl").MapGeoJSONFeature[];
  }) => void) | null>(null);
  if (!pickRef.current) {
    pickRef.current = (e) => {
      if (!liveRef.current.picking) return;
      liveRef.current.onPickCenter({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };
  }
  if (!clickRef.current) {
    clickRef.current = (e) => {
      // Pick mode owns every click (see pickRef above).
      if (liveRef.current.picking) return;
      const key = e.features?.[0]?.properties?.["key"];
      if (typeof key !== "string") return;
      const pin = liveRef.current.pins.find((p) => p.key === key);
      if (!pin) return;
      liveRef.current.onPinClick(pin);
      const ml2 = mlRef.current;
      const map2 = mapRef.current;
      if (!ml2 || !map2) return;
      popupRef.current?.remove();
      const el = document.createElement("div");
      el.className = "map-pin-card";
      const initial = pin.label.trim().charAt(0).toUpperCase() || "?";
      const role = pin.layer === "suspect" ? "Suspect" : pin.layer === "device" ? "Device" : "Tower";
      const roleColor = pin.layer === "suspect" ? SUSPECT_COLOR : pin.layer === "device" ? DEVICE_COLOR : TOWER_COLOR;
      el.innerHTML =
        `<div class="head"><span class="avatar">${escapeHtml(initial)}</span>` +
        `<b>${escapeHtml(pin.label)}</b>` +
        `<span class="role" style="color:${roleColor};border-color:${roleColor}55">${role}</span></div>` +
        `<span>${escapeHtml(pin.sub)}</span>` +
        `<span class="dim">${escapeHtml(pin.detail)}</span>` +
        `<button type="button">View Details</button>`;
      if (pin.entity_id != null) {
        el.querySelector("button")?.addEventListener("click", () => liveRef.current.onViewDetails(pin.entity_id as number));
      } else {
        el.querySelector("button")?.remove();
      }
      const at = liveRef.current.coords.get(pin.key);
      popupRef.current = new ml2.Popup({ closeButton: true, maxWidth: "260px" })
        .setLngLat(at ?? e.lngLat)
        .setDOMContent(el)
        .addTo(map2);
    };
  }

  function features(layer: "suspect" | "device" | "tower", withConf = false) {
    const { pins: list, coords: at } = liveRef.current;
    return list
      .filter((p) => p.layer === layer)
      .map((p) => ({ key: p.key, at: at.get(p.key) }))
      .filter((f): f is { key: string; at: { lng: number; lat: number; conf: number } } => !!f.at)
      .map((f) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [f.at.lng, f.at.lat] },
        properties: withConf ? { key: f.key, conf: f.at.conf } : { key: f.key },
      }));
  }

  function syncData() {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of ["suspect", "device", "tower"] as const) {
      const src = map.getSource(`pins-${layer}`) as { setData?: (d: unknown) => void } | undefined;
      src?.setData?.({ type: "FeatureCollection", features: features(layer) });
    }
    // Density heatmap over the same visible pins (confidence-weighted), so
    // Layers/Filters apply to it instantly — no separate backend math.
    const heat = map.getSource("heatmap-src") as { setData?: (d: unknown) => void } | undefined;
    heat?.setData?.({
      type: "FeatureCollection",
      features: [
        ...features("suspect", true), ...features("device", true), ...features("tower", true),
      ],
    });
    if (map.getLayer("heatmap")) {
      map.setLayoutProperty("heatmap", "visibility", liveRef.current.showHeat ? "visible" : "none");
    }
    if (map.getLayer("buildings-3d")) {
      map.setLayoutProperty("buildings-3d", "visibility", liveRef.current.buildings3d ? "visible" : "none");
    }
    const area = liveRef.current.areaRing;
    const asrc = map.getSource("selected-area") as { setData?: (d: unknown) => void } | undefined;
    asrc?.setData?.({
      type: "FeatureCollection",
      features: area ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: area }, properties: {} }] : [],
    });
    for (const lid of ["selected-area-fill", "selected-area-line"]) {
      if (map.getLayer(lid)) {
        map.setLayoutProperty(lid, "visibility", liveRef.current.showArea && area ? "visible" : "none");
      }
    }
    // Selection ring lives on its own source so suspect/device selections
    // both ring without layer juggling.
    const sel = liveRef.current.selectedKey;
    const at = sel ? liveRef.current.coords.get(sel) : undefined;
    const ringSrc = map.getSource("pin-ring") as { setData?: (d: unknown) => void } | undefined;
    ringSrc?.setData?.({
      type: "FeatureCollection",
      features: at
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [at.lng, at.lat] }, properties: {} }]
        : [],
    });
    const sm = liveRef.current.searchMark;
    const ssrc = map.getSource("search-mark") as { setData?: (d: unknown) => void } | undefined;
    ssrc?.setData?.({
      type: "FeatureCollection",
      features: sm
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [sm.lng, sm.lat] }, properties: {} }]
        : [],
    });
    // Trail frame: line grows through visited points in order; marker sits
    // on the current one. Single-point (or empty) trails clear the line —
    // a one-dot "path" would imply movement that isn't evidenced.
    const tr = liveRef.current.trail ?? [];
    const upto = Math.min(liveRef.current.frameIdx + 1, tr.length);
    const seg = tr.slice(0, upto);
    const lineSrc = map.getSource("trail-line") as { setData?: (d: unknown) => void } | undefined;
    lineSrc?.setData?.({
      type: "FeatureCollection",
      features: seg.length >= 2
        ? [{ type: "Feature", geometry: { type: "LineString", coordinates: seg.map((p) => [p.lng, p.lat]) }, properties: {} }]
        : [],
    });
    const cur = seg[seg.length - 1];
    const ptSrc = map.getSource("trail-point") as { setData?: (d: unknown) => void } | undefined;
    ptSrc?.setData?.({
      type: "FeatureCollection",
      features: cur
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [cur.lng, cur.lat] }, properties: {} }]
        : [],
    });
    // Nearby: center marker, true-distance radius disc, hit pins.
    const nc = liveRef.current.center;
    const ncsrc = map.getSource("nearby-center") as { setData?: (d: unknown) => void } | undefined;
    ncsrc?.setData?.({
      type: "FeatureCollection",
      features: nc
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [nc.lng, nc.lat] }, properties: {} }]
        : [],
    });
    const ncirc = map.getSource("nearby-circle") as { setData?: (d: unknown) => void } | undefined;
    ncirc?.setData?.({
      type: "FeatureCollection",
      features: nc ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [disc(nc, liveRef.current.radiusKm)] }, properties: {} }] : [],
    });
    const nhits = map.getSource("nearby-hits") as { setData?: (d: unknown) => void } | undefined;
    nhits?.setData?.({
      type: "FeatureCollection",
      features: liveRef.current.hits.map((h) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        properties: { key: h.key },
      })),
    });
  }

  function disc(c: { lng: number; lat: number }, radiusKm: number): number[][] {
    // 64-gon of true destination points (spherical earth): the disc means
    // kilometers on the ground, matching the backend haversine cutoff.
    const R = 6371;
    const lat0 = (c.lat * Math.PI) / 180;
    const lng0 = (c.lng * Math.PI) / 180;
    const d = Math.max(radiusKm, 0.05) / R;
    const ring: number[][] = [];
    for (let i = 0; i < 64; i++) {
      const brg = (i / 64) * 2 * Math.PI;
      const lat1 = Math.asin(Math.sin(lat0) * Math.cos(d) + Math.cos(lat0) * Math.sin(d) * Math.cos(brg));
      const lng1 = lng0 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat0), Math.cos(d) - Math.sin(lat0) * Math.sin(lat1));
      ring.push([(lng1 * 180) / Math.PI, (lat1 * 180) / Math.PI]);
    }
    const first = ring[0];
    if (first) ring.push([...first]);
    return ring;
  }

  function setupLayers() {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml) return;
    const defs: { id: string; source: string; color: string; size: number }[] = [
      { id: "pins-suspect", source: "pins-suspect", color: SUSPECT_COLOR, size: 9 },
      { id: "pins-device", source: "pins-device", color: DEVICE_COLOR, size: 8 },
      { id: "pins-tower", source: "pins-tower", color: TOWER_COLOR, size: 7 },
    ];
    for (const src of ["pins-suspect", "pins-device", "pins-tower", "pin-ring", "search-mark", "heatmap-src", "trail-line", "trail-point", "nearby-center", "nearby-circle", "nearby-hits"] as const) {
      if (!map.getSource(src)) {
        map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
    }
    // Movement trail: growing cyan line + current-position marker. Rendered
    // strictly from dated trail points (never synthesized); empty when none.
    if (!map.getLayer("trail-line")) {
      map.addLayer({
        id: "trail-line", type: "line", source: "trail-line",
        paint: { "line-color": "#00d9ff", "line-width": 3, "line-opacity": 0.9 },
      });
    }
    if (!map.getLayer("trail-point")) {
      map.addLayer({
        id: "trail-point", type: "circle", source: "trail-point",
        paint: {
          "circle-radius": 9, "circle-color": "#00d9ff",
          "circle-stroke-width": 3, "circle-stroke-color": "#ffffff",
        },
      });
    }
    for (const d of defs) {
      if (map.getLayer(d.id)) continue;
      map.addLayer({
        id: d.id, type: "circle", source: d.source,
        paint: {
          "circle-radius": d.size,
          "circle-color": d.color,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0d1117",
        },
      });
    }
    if (!map.getLayer("pin-selected")) {
      map.addLayer({
        id: "pin-selected", type: "circle", source: "pin-ring",
        paint: {
          "circle-radius": 14, "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
        },
      });
    }
    if (!map.getLayer("search-marker")) {
      map.addLayer({
        id: "search-marker", type: "circle", source: "search-mark",
        paint: {
          "circle-radius": 7, "circle-color": "#a78bfa",
          "circle-stroke-width": 2, "circle-stroke-color": "#0d1117",
        },
      });
    }
    // 3D buildings ride the style's own openmaptiles vector source
    // (OpenFreeMap/Carto vector styles carry it; OSM-raster/offline do
    // not). Buildings without render_height extrude to the documented
    // 12 m default instead of flat.
    if (!map.getLayer("buildings-3d")) {
      try {
        map.addLayer(
          {
            id: "buildings-3d",
            type: "fill-extrusion",
            source: "openmaptiles",
            "source-layer": "building",
            minzoom: 13,
            paint: {
              "fill-extrusion-color": "#8b95a3",
              "fill-extrusion-opacity": 0.75,
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-vertical-gradient": true,
            },
            layout: { visibility: liveRef.current.buildings3d ? "visible" : "none" },
          },
          "pins-suspect"
        );
        // Vector style confirmed (e.g. after a live-tile upgrade remount):
        // the 3D toggle is usable again.
        liveRef.current.onBuildingsAvailable?.();
      } catch {
        // Style without an openmaptiles/building source: 3D simply stays
        // unavailable (toggle shows it as such — see parent wiring).
        liveRef.current.onBuildingsUnavailable?.();
      }
    }
    if (!map.getLayer("heatmap")) {
      map.addLayer(
        {
          id: "heatmap", type: "heatmap", source: "heatmap-src",
          maxzoom: 15,
          paint: {
            "heatmap-weight": ["coalesce", ["get", "conf"], 0.5],
            "heatmap-intensity": 1,
            "heatmap-radius": 32,
            "heatmap-opacity": 0.75,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.3, "rgba(251,191,36,0.55)",
              0.7, "rgba(251,146,60,0.8)",
              1, "rgba(248,113,113,0.9)",
            ],
          },
          layout: { visibility: liveRef.current.showHeat ? "visible" : "none" },
        },
        "pins-suspect"
      );
    }
    // Nearby search visuals: hollow center marker, radius disc, hit pins.
    if (!map.getLayer("nearby-center")) {
      map.addLayer({
        id: "nearby-center", type: "circle", source: "nearby-center",
        paint: {
          "circle-radius": 6, "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
        },
      });
    }
    if (!map.getLayer("nearby-circle")) {
      map.addLayer(
        {
          id: "nearby-circle", type: "fill", source: "nearby-circle",
          paint: { "fill-color": "#a78bfa", "fill-opacity": 0.08 },
        },
        "nearby-center"
      );
    }
    if (!map.getLayer("nearby-hits")) {
      map.addLayer({
        id: "nearby-hits", type: "circle", source: "nearby-hits",
        paint: {
          "circle-radius": 8, "circle-color": "#a78bfa",
          "circle-stroke-width": 2, "circle-stroke-color": "#0d1117",
        },
      });
    }
    // Our own copy of the drawn area (Terra Draw's sketch is cleared on
    // finish so nothing double-renders); the Layers toggle owns visibility.
    if (!map.getSource("selected-area")) {
      map.addSource("selected-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!map.getLayer("selected-area-fill")) {
      map.addLayer({
        id: "selected-area-fill", type: "fill", source: "selected-area",
        paint: { "fill-color": "#a78bfa", "fill-opacity": 0.12 },
      });
    }
    if (!map.getLayer("selected-area-line")) {
      map.addLayer({
        id: "selected-area-line", type: "line", source: "selected-area",
        paint: { "line-color": "#a78bfa", "line-width": 2, "line-dasharray": [5, 4] },
      });
    }
    const onClick = clickRef.current;
    if (!onClick) return;
    for (const layer of ["pins-suspect", "pins-device", "pins-tower"]) {
      try { map.off("click", layer, onClick); } catch { /* ignore */ }
      map.on("click", layer, onClick);
    }
    const pick = pickRef.current;
    if (pick) {
      try { map.off("click", pick); } catch { /* ignore */ }
      map.on("click", pick);
    }
    syncData();
  }

  // Post-mount tile watchdog: single 404s are routine (edge tiles, high
  // zoom); only sustained failure earns a banner — never a full overlay.
  // Guarded on map identity so a replaced map's errors stay silent.
  function watchTiles(map: import("maplibre-gl").Map, label: string) {
    let errorCount = 0;
    map.on("error", () => {
      errorCount += 1;
      if (errorCount < 4 || mapRef.current !== (map as never)) return;
      liveRef.current.onTileWarn?.(`Base tiles degraded (${label}). Pins and data are unaffected.`);
    });
  }

  function attachMap(map: import("maplibre-gl").Map, ml: typeof import("maplibre-gl")) {
    mapRef.current = map as never;
    map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-left");
    setupLayers();
    syncData();
    watchTiles(map, liveRef.current.styleUrl);
  }

  // Background live-tile upgrade: race every candidate CONCURRENTLY in
  // hidden probe maps (real `load` + tile-content verification), swap the
  // first verified winner onto the visible map via a staging div (camera
  // preserved, never blanked). Failures are console telemetry only until
  // every candidate fails — then the honest offline end-state.
  async function runUpgrade() {
    const gen = ++upgradeGen.current;
    // Wait for the offline mount (bounded; StrictMode-safe).
    const t0 = Date.now();
    while (!mountedRef.current && Date.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 150));
      if (gen !== upgradeGen.current) return;
    }
    const ml = mlRef.current;
    if (!ml || !mountedRef.current || gen !== upgradeGen.current) return;
    const { upgradeCandidates, raceCandidates, awaitMapLoad, createMapTransformRequest, logTile } = await import("@/lib/mapStyles");
    if (gen !== upgradeGen.current) return;
    const pref = liveRef.current.styleUrl;
    const cands = upgradeCandidates(pref);
    const start = Date.now();
    const win = await raceCandidates(ml as never, cands, {
      isCancelled: () => gen !== upgradeGen.current,
      onProbe: (label, ok, ms) => logTile("candidate-probe", `${label} → ${ok ? "VERIFIED" : "failed"} in ${ms}ms`),
    });
    if (!win || gen !== upgradeGen.current) {
      if (!win && gen === upgradeGen.current) {
        // Every candidate failed: honest offline end-state (map already works).
        liveRef.current.onStyleLabel?.("Offline base");
        liveRef.current.onTileWarn?.("Live tiles unreachable — offline base. Pins and data are live.");
        logTile("upgrade", `all ${cands.length} candidates failed in ${Date.now() - start}ms`);
      }
      return;
    }

    // Winner: swap onto the visible map, camera preserved without blanking.
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
        // Just-proven style failed on the visible stage (flaky GL): stay on
        // the working map and say so honestly.
        liveRef.current.onTileWarn?.("Live tiles flickered — staying on the working base.");
        return;
      }

      // Winner successfully loaded! Safely swap:
      try { prev?.remove(); } catch { /* ignore */ }
      if (divRef.current) {
        Array.from(divRef.current.children).forEach((el) => {
          if (el !== staging) el.remove();
        });
      }
      attachMap(map, ml);
      liveRef.current.onStyleLabel?.(`${win.label} · live`);
      liveRef.current.onTileOk();
      logTile("upgrade", `${win.label} live in ${Date.now() - start}ms`);
      return;
    } catch {
      try { staging.remove(); } catch { /* ignore */ }
      return;
    }
  }

  // Mount once: OFFLINE base first (all-local, zero network). Pins, heat,
  // trails and draw tools are interactive in <1s; live tiles upgrade in
  // the background via runUpgrade().
  useEffect(() => {
    let dead = false;
    let ro: ResizeObserver | null = null;
    const genRef = upgradeGen;
    const mountRef = mountedRef;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    (async () => {
      let ml: typeof import("maplibre-gl");
      try {
        ml = await import("maplibre-gl");
      } catch {
        if (!dead) liveRef.current.onTileError("Map library failed to load. Check your connection and retry.");
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
        attachMap(map, ml);
        mountedRef.current = true;
        liveRef.current.onStyleLabel?.("Offline base · locating live tiles…");
        if (!fittedRef.current) {
          fittedRef.current = true;
          fitToPins();
        }
        logTile("offline-mount", `${Math.round(performance.now() - t0)}ms`);
        ro = new ResizeObserver(() => {
          try { mapRef.current?.resize(); } catch { /* ignore */ }
        });
        if (divRef.current) ro.observe(divRef.current);
      } catch {
        if (!dead) liveRef.current.onTileError("Map failed to start. Check your connection and retry.");
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

  // Live-tile upgrade passes: preference switch or manual Retry re-runs the
  // background loop. The visible (offline or live) map never blocks on it.
  useEffect(() => {
    const genRef = upgradeGen;
    void runUpgrade();
    return () => {
      genRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileRetrySignal, styleUrl]);

  // Data / selection / search / fit updates. syncData is ref-stable by
  // construction (reads only liveRef/mapRef), so it is not a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncData(); }, [pins, coords, selectedKey, searchMark, showArea, showHeat, buildings3d, areaRing, trail, frameIdx, center, radiusKm, hits]);

  // Hit-row fly-to from the results list.
  useEffect(() => {
    const map = mapRef.current;
    const fp = focusPt;
    if (!map || !fp) return;
    try {
      map.flyTo({ center: [fp.lng, fp.lat], zoom: Math.max(map.getZoom(), 11) });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPt]);

  // Map-view capture for the court-ready exhibit: repaint, then read the
  // canvas inside the same render frame (WebGL buffers without
  // preserveDrawingBuffer are only valid there). Timeout reports null.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || captureSignal === 0) return;
    let done = false;
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      try { map.off("render", onRender); } catch { /* ignore */ }
      liveRef.current.onCapture(blob);
    };
    const onRender = () => {
      try {
        const canvas = map.getCanvas();
        if (canvas.toBlob) canvas.toBlob((b) => finish(b));
        else finish(null);
      } catch {
        finish(null);
      }
    };
    const timer = setTimeout(() => finish(null), 4000);
    try {
      map.once("render", onRender);
      map.triggerRepaint();
    } catch {
      clearTimeout(timer);
      finish(null);
    }
    return () => {
      clearTimeout(timer);
      try { map.off("render", onRender); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureSignal]);

  // Drag-a-pin correction marker: one violet draggable marker while a move
  // is pending; release fires onMoveEnd (parent PATCHes + refreshes).
  const moveRef = useRef<import("maplibre-gl").Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    const mm = moveMark;
    try { moveRef.current?.remove(); } catch { /* ignore */ }
    moveRef.current = null;
    if (!map || !ml || !mm) return;
    const el = document.createElement("div");
    el.setAttribute("aria-label", "Drag to correct pin position");
    el.style.cssText =
      "width:18px;height:18px;border-radius:50%;background:#a78bfa;" +
      "border:3px solid #ffffff;box-shadow:0 0 0 2px #a78bfa;cursor:grab;";
    try {
      const marker = new ml.Marker({ element: el, draggable: true })
        .setLngLat([mm.lng, mm.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const at = marker.getLngLat();
        liveRef.current.onMoveEnd(at.lng, at.lat);
      });
      moveRef.current = marker;
    } catch { /* ignore */ }
    return () => {
      try { moveRef.current?.remove(); } catch { /* ignore */ }
      moveRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveMark]);

  // Camera follows the trail's current point (play and scrub alike — the
  // panel is a single-entity timeline, so tracking is the point).
  useEffect(() => {
    const map = mapRef.current;
    const tr = trail;
    if (!map || !tr || !tr.length) return;
    const cur = tr[Math.min(frameIdx, tr.length - 1)];
    if (!cur) return;
    try {
      map.flyTo({ center: [cur.lng, cur.lat], zoom: Math.max(map.getZoom(), 11) });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail, frameIdx]);

  // 3D tilt follows the toggle (once per toggle, not per data change):
  // extrusions only read at an angle; flat view returns on disable.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (buildings3d) map.easeTo({ pitch: 60, bearing: -20, duration: 800 });
      else map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings3d]);

  function showAreaPopup(ring: number[][][], insideKeys: string[]) {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml) return;
    popupRef.current?.remove();
    const el = document.createElement("div");
    el.className = "map-pin-card";
    const n = insideKeys.length;
    el.innerHTML =
      `<b>${n} ${n === 1 ? "entity" : "entities"} in this area</b>` +
      `<span class="dim">of ${liveRef.current.pins.length} plotted pins</span>` +
      (n > 0 ? `<button type="button">Isolate in Network Graph</button>` : `<span>Draw a wider area to catch pins.</span>`);
    if (n > 0) {
      el.querySelector("button")?.addEventListener("click", () => liveRef.current.onIsolate(insideKeys));
    }
    // Bbox center of the outer ring (good enough for a popup anchor).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring[0] ?? []) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    popupRef.current = new ml.Popup({ closeButton: true, maxWidth: "260px" })
      .setLngLat([(x0 + x1) / 2, (y0 + y1) / 2])
      .setDOMContent(el)
      .addTo(map);
  }

  async function insideRing(ring: number[][][]): Promise<string[]> {
    const { booleanPointInPolygon } = await import("@turf/boolean-point-in-polygon");
    const poly = { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: ring } };
    const out: string[] = [];
    for (const p of liveRef.current.pins) {
      const at = liveRef.current.coords.get(p.key);
      if (!at) continue;
      try {
        if (booleanPointInPolygon([at.lng, at.lat], poly)) out.push(p.key);
      } catch { /* ignore malformed geometry */ }
    }
    return out;
  }

  // Draw-mode lifecycle: create the Terra Draw instance lazily (dynamic
  // imports keep it out of the SSR bundle), switch polygon/select modes.
  // On finish: Turf point-in-polygon over the VISIBLE pins, clear Terra
  // Draw's own sketch (our selected-area copy renders instead, so nothing
  // double-draws), report up, and pop the count card.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let dead = false;
    if (!drawActive) {
      try { drawRef.current?.draw.setMode("select"); } catch { /* ignore */ }
      return;
    }
    (async () => {
      try {
        if (!drawRef.current) {
          const [{ TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode }, { TerraDrawMapLibreGLAdapter }] = await Promise.all([
            import("terra-draw"),
            import("terra-draw-maplibre-gl-adapter"),
          ]);
          if (dead || !mapRef.current) return;
          const draw = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({ map: mapRef.current }),
            modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode()],
          });
          draw.start();
          draw.on("finish", () => {
            void (async () => {
              try {
                const snap = drawRef.current?.draw.getSnapshot() ?? [];
                const poly = snap.find((f) => f.geometry?.type === "Polygon");
                const coords = poly?.geometry && "coordinates" in poly.geometry
                  ? (poly.geometry.coordinates as unknown)
                  : null;
                if (!Array.isArray(coords)) return;
                const ring = coords as number[][][];
                const inside = await insideRing(ring);
                try { drawRef.current?.draw.clear(); } catch { /* ignore */ }
                try { drawRef.current?.draw.setMode("select"); } catch { /* ignore */ }
                if (dead) return;
                liveRef.current.onAreaFinish(ring, inside);
                showAreaPopup(ring, inside);
              } catch { /* ignore */ }
            })();
          });
          drawRef.current = { draw };
        }
        if (!dead) drawRef.current.draw.setMode("polygon");
      } catch {
        liveRef.current.onTileError("Drawing library failed to load. Check your connection and retry.");
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawActive]);

  // Clear signal from the toolbar.
  useEffect(() => {
    if (clearSignal === 0) return;
    try { drawRef.current?.draw.clear(); } catch { /* ignore */ }
    try { drawRef.current?.draw.setMode("select"); } catch { /* ignore */ }
    try { popupRef.current?.remove(); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal]);
  useEffect(() => {
    const map = mapRef.current;
    const sm = searchMark;
    if (!map || !sm) return;
    try { map.flyTo({ center: [sm.lng, sm.lat], zoom: Math.max(map.getZoom(), 10) }); } catch { /* ignore */ }
  }, [searchMark]);
  useEffect(() => {
    if (fitSignal > 0) fitToPins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  function fitToPins() {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml) return;
    const pts = liveRef.current.pins
      .map((p) => liveRef.current.coords.get(p.key))
      .filter((c): c is { lng: number; lat: number; conf: number } => !!c);
    const first = pts[0];
    if (!first) return;
    try {
      const b = new ml.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
      for (const p of pts.slice(1)) b.extend([p.lng, p.lat]);
      map.fitBounds(b, { padding: 70, maxZoom: 13 });
    } catch { /* ignore */ }
  }

  return (
    <>
      <style>{`.map-pin-card{display:flex;flex-direction:column;gap:4px;max-width:230px;color:#e6edf3}
.map-pin-card .head{display:flex;align-items:center;gap:7px}
.map-pin-card .avatar{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:3px;border:1px solid #1a2230;background:#11161d;font-family:monospace;font-size:10px;font-weight:600;color:#a3b1c2}
.map-pin-card .role{margin-left:auto;font-family:monospace;font-size:9px;text-transform:uppercase;letter-spacing:.05em;border:1px solid;border-radius:3px;padding:1px 5px;white-space:nowrap}
.map-pin-card b{font-size:12.5px;font-weight:600}
.map-pin-card span{font-size:11.5px;color:#a3b1c2}
.map-pin-card span.dim{font-family:monospace;font-size:10px;color:#6b7a8d}
.map-pin-card button{margin-top:4px;border:1px solid #00d9ff55;border-radius:3px;color:#00d9ff;font-family:monospace;font-size:11px;padding:4px 8px;cursor:pointer;background:transparent}
.maplibregl-popup-content{background:#0d1117!important;border:1px solid #1a2230;border-radius:6px!important;padding:10px 12px!important}
.maplibregl-popup-content .map-pin-card{color:#e6edf3}
.maplibregl-popup-tip{border-top-color:#1a2230!important;border-bottom-color:#1a2230!important}
.maplibregl-popup-close-button{color:#a3b1c2!important}`}</style>
      <div ref={divRef} className="absolute inset-0" role="application" aria-label="Case map" />
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
