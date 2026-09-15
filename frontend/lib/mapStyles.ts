/** Resilient base maps for MapLibre (Map tab + Districts) — offline-first.
 *
 * Architecture:
 *  1. OFFLINE-FIRST MOUNT: All-local style (dark canvas, tactical grid,
 *     bundled Natural Earth India boundaries, zero network) mounts
 *     synchronously. Pins, heatmaps, trails and draw tools are interactive
 *     in <1s.
 *  2. SAME-ORIGIN TILE PROXY + transformRequest: All remote tile, font,
 *     sprite, and TileJSON requests are routed through Next.js `/tiles/*`
 *     rewrites. The browser never touches third-party hosts directly,
 *     bypassing corporate firewalls, DNS blocks, and ad blockers.
 *  3. PARALLEL TILE-VERIFIED UPGRADE: Remote candidates race concurrently
 *     in off-screen probe maps. A win requires real `load` PLUS tile content
 *     (`areTilesLoaded`) — `load` alone fires on empty canvases, notably for
 *     raster styles whose tiles then fail. First verified win swaps onto the
 *     visible map via a staging div (never blanking); losers self-clean.
 *     Sequential probing (6 × ~9s ≈ 54s worst case) read as "stuck".
 */

export type MapStyleValue = string | Record<string, unknown>;

export interface BaseCandidate {
  label: string;
  getStyle: () => Promise<MapStyleValue>;
}

export interface OfflineBounds {
  states: { type: string; features: unknown[] } | null;
  country: { type: string; features: unknown[] } | null;
}

const OFM_HOST = "https://tiles.openfreemap.org";
const CARTO_HOST = "https://basemaps.cartocdn.com";

export const OFM_STYLES: Record<string, string> = {
  liberty: `${OFM_HOST}/styles/liberty`,
  bright: `${OFM_HOST}/styles/bright`,
  positron: `${OFM_HOST}/styles/positron`,
};

/**
 * Request transformer for MapLibre GL JS to intercept ANY remote tile, font,
 * sprite, or TileJSON request and funnel it through our same-origin proxy.
 */
export function createMapTransformRequest(): (url: string) => { url: string } {
  return (url: string) => {
    try {
      if (typeof window === "undefined") return { url };
      // Intercept OpenFreeMap tiles, fonts, sprites, planet TileJSON
      if (url.startsWith("https://tiles.openfreemap.org/")) {
        return { url: url.replace("https://tiles.openfreemap.org", "/tiles/ofm") };
      }
      // Intercept Carto tiles (covers basemaps.cartocdn.com, tiles-*.basemaps.cartocdn.com, a.basemaps.cartocdn.com)
      const cartoMatch = url.match(/^https:\/\/(?:[a-z0-9-]+[.])?basemaps\.cartocdn\.com\/(.*)$/);
      if (cartoMatch) {
        return { url: `/tiles/carto/${cartoMatch[1]}` };
      }
      // Intercept OpenStreetMap raster
      if (url.startsWith("https://tile.openstreetmap.org/")) {
        return { url: url.replace("https://tile.openstreetmap.org", "/tiles/osm") };
      }
    } catch {
      /* ignore */
    }
    return { url };
  };
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a GL style through our proxy and rewrite every host ref same-origin. */
async function proxiedStyle(stylePath: string, host: string, prefix: string): Promise<Record<string, unknown>> {
  const text = await fetchText(stylePath, 6000);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  let rewritten = text.split(host).join(`${origin}${prefix}`);
  if (host === CARTO_HOST) {
    rewritten = rewritten.split("https://tiles.basemaps.cartocdn.com").join(`${origin}${prefix}`);
    rewritten = rewritten.split("https://tiles-a.basemaps.cartocdn.com").join(`${origin}${prefix}`);
  }
  const parsed: unknown = JSON.parse(rewritten);
  if (!parsed || typeof parsed !== "object") throw new Error(`bad style JSON from ${stylePath}`);
  return parsed as Record<string, unknown>;
}

/** OSM Standard raster via the given tile template (keyless; proxied in the chain). */
function osmRasterStyle(tilesUrl: string): Record<string, unknown> {
  return {
    version: 8,
    name: "OSM raster",
    sources: {
      osm: {
        type: "raster",
        tiles: [tilesUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

/**
 * Ordered live-tile upgrade candidates. `preferred` is the user's OFM style URL.
 *
 * All keyless on purpose: CARTO basemaps now require an API key and stamp
 * "API KEY REQUIRED" watermarks without one, so no Carto source is listed.
 * OpenFreeMap and OSM need no keys.
 */
export function upgradeCandidates(preferred?: string): BaseCandidate[] {
  const out: BaseCandidate[] = [];

  // 1. OpenFreeMap vector styles via same-origin proxy (keyless, full cartography)
  const ofmByLabel: { label: string; url: string }[] = [
    { label: "OpenFreeMap Liberty", url: OFM_STYLES.liberty },
    { label: "OpenFreeMap Positron", url: OFM_STYLES.positron },
    { label: "OpenFreeMap Bright", url: OFM_STYLES.bright },
  ];
  if (preferred) {
    const idx = ofmByLabel.findIndex((c) => c.url === preferred);
    if (idx > 0) {
      const [pick] = ofmByLabel.splice(idx, 1);
      ofmByLabel.unshift(pick);
    }
  }
  for (const c of ofmByLabel) {
    out.push({
      label: `${c.label} · proxy`,
      getStyle: () => proxiedStyle(`/tiles/ofm/styles/${styleName(c.url)}`, OFM_HOST, "/tiles/ofm"),
    });
  }

  // 2. Direct (unproxied) OpenFreeMap — covers "proxy broken, browser fine".
  out.push({ label: "OpenFreeMap Liberty · direct", getStyle: () => Promise.resolve(OFM_STYLES.liberty) });

  // 3. OSM Standard raster via same-origin proxy (keyless, lowest fidelity, highest reliability)
  out.push({
    label: "OSM Standard · proxy",
    getStyle: () => Promise.resolve(osmRasterStyle("/tiles/osm/{z}/{x}/{y}.png")),
  });

  return out;
}

function styleName(url: string): string {
  return url.substring(url.lastIndexOf("/") + 1);
}

/* ---------------- offline base ---------------- */

let boundsPromise: Promise<OfflineBounds> | null = null;

/** Bundled India boundaries (lazy, cached). Never throws — nulls on failure. */
export function loadBoundaries(): Promise<OfflineBounds> {
  if (!boundsPromise) {
    boundsPromise = (async (): Promise<OfflineBounds> => {
      const get = async (p: string) => {
        try {
          const r = await fetch(p);
          if (!r.ok) return null;
          return (await r.json()) as { type: string; features: unknown[] };
        } catch {
          return null;
        }
      };
      const [states, country] = await Promise.all([
        get("/geo/india-states.json"),
        get("/geo/india-admin0.json"),
      ]);
      return { states, country };
    })();
  }
  return boundsPromise;
}

/** Procedural 10° graticule — pure inline GeoJSON, looks intentional offline. */
function graticule(): { type: string; features: Record<string, unknown>[] } {
  const features: Record<string, unknown>[] = [];
  for (let lng = -180; lng <= 180; lng += 10) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[lng, -85], [lng, 85]] },
    });
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] },
    });
  }
  return { type: "FeatureCollection", features };
}

/** All-local tactical style: background + graticule + India boundaries. High contrast & clear. */
export function buildOfflineStyle(bounds: OfflineBounds | null): Record<string, unknown> {
  const sources: Record<string, unknown> = {
    grid: {
      type: "geojson",
      data: graticule(),
      attribution: "Reference grid",
    },
  };
  const layers: Record<string, unknown>[] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#090e17" },
    },
    {
      id: "grid",
      type: "line",
      source: "grid",
      paint: {
        "line-color": "rgba(0, 217, 255, 0.12)",
        "line-width": 1,
        "line-dasharray": [2, 4],
      },
    },
  ];
  if (bounds?.states) {
    sources["in-states"] = {
      type: "geojson",
      data: bounds.states,
      attribution: "Boundaries © Natural Earth",
    };
    layers.push({
      id: "in-states-fill",
      type: "fill",
      source: "in-states",
      paint: { "fill-color": "rgba(0, 217, 255, 0.08)" },
    });
    layers.push({
      id: "in-states-line",
      type: "line",
      source: "in-states",
      paint: { "line-color": "rgba(0, 217, 255, 0.45)", "line-width": 1.2 },
    });
  }
  if (bounds?.country) {
    sources["in-country"] = {
      type: "geojson",
      data: bounds.country,
      attribution: "Boundaries © Natural Earth",
    };
    layers.push({
      id: "in-country-line",
      type: "line",
      source: "in-country",
      paint: { "line-color": "rgba(0, 217, 255, 0.85)", "line-width": 2 },
    });
  }
  return { version: 8, name: "PRAMAAN offline tactical", sources, layers };
}

/* ---------------- hidden probe ---------------- */

export interface ProbeMap {
  on: (ev: string, cb: (e?: unknown) => void) => void;
  once: (ev: string, cb: (e?: unknown) => void) => void;
  off: (ev: string, cb: (e?: unknown) => void) => void;
  remove: () => void;
  loaded?: () => boolean;
  areTilesLoaded?: () => boolean;
}

export interface ProbeMapModule {
  Map: new (opts: Record<string, unknown>) => ProbeMap;
}

/** Fresh off-screen container per probe (parallel races share nothing). */
function makeProbeDiv(): HTMLDivElement {
  const div = document.createElement("div");
  div.setAttribute("aria-hidden", "true");
  div.style.cssText =
    "position:fixed;width:256px;height:256px;left:-10000px;top:0;visibility:hidden;pointer-events:none;";
  document.body.appendChild(div);
  return div;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function awaitLoaded(map: ProbeMap, timeoutMs: number, maxErrors: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (map.loaded && map.loaded()) {
      resolve(true);
      return;
    }
    let settled = false;
    let errors = 0;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { map.off("load", onLoad); } catch { /* ignore */ }
      try { map.off("error", onError); } catch { /* ignore */ }
      resolve(ok);
    };
    const onLoad = () => done(true);
    const onError = (e: unknown) => {
      // Fail fast on auth failures or sustained tile breakage; routine
      // single-tile 404s are tolerated (the tile-content gate below decides).
      const err = e as { error?: { status?: number } };
      errors += 1;
      if (err?.error?.status === 401 || err?.error?.status === 403 || errors >= maxErrors) {
        done(false);
      }
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    map.once("load", onLoad);
    map.on("error", onError);
  });
}

/**
 * Prove a style REALLY renders: real `load` in an off-screen map AND tile
 * content verified via `areTilesLoaded()`. `load` alone can fire on an empty
 * canvas (notably raster styles whose tiles then fail) — the blank-white
 * map labeled "live". Own container per call, so probes race safely in
 * parallel. Always cleans up. Never throws.
 */
export async function probeCandidateFull(
  ml: ProbeMapModule,
  style: MapStyleValue,
  opts?: { loadTimeoutMs?: number; tileDeadlineMs?: number; maxErrors?: number; isCancelled?: () => boolean }
): Promise<boolean> {
  const loadTimeoutMs = opts?.loadTimeoutMs ?? 9000;
  const tileDeadlineMs = opts?.tileDeadlineMs ?? 6000;
  const maxErrors = opts?.maxErrors ?? 8;
  const div = makeProbeDiv();
  let map: ProbeMap | null = null;
  try {
    map = new ml.Map({
      container: div,
      style,
      center: [78.9, 21.1],
      zoom: 4,
      fadeDuration: 0,
      transformRequest: createMapTransformRequest(),
      attributionControl: false,
      interactive: false,
    });
    if (!(await awaitLoaded(map, loadTimeoutMs, maxErrors))) return false;
    if (opts?.isCancelled?.()) return false;
    // Tile-content gate: the map must report tiles done before the deadline.
    const t0 = Date.now();
    for (;;) {
      try {
        if (typeof map.areTilesLoaded !== "function" || map.areTilesLoaded()) return true;
      } catch {
        return true; // API unavailable — load already proved renderable
      }
      if (Date.now() - t0 > tileDeadlineMs || opts?.isCancelled?.()) break;
      await sleep(250);
    }
    try {
      return typeof map.areTilesLoaded === "function" ? map.areTilesLoaded() : true;
    } catch {
      return true;
    }
  } catch {
    return false;
  } finally {
    try { map?.remove(); } catch { /* ignore */ }
    try { div.remove(); } catch { /* ignore */ }
  }
}

/**
 * Race every candidate CONCURRENTLY; first tile-verified win takes it.
 * Sequential probing (6 × ~9s ≈ 54s worst case) is why upgrades looked
 * "stuck". Losers self-clean; the deadline bounds the whole pass.
 */
export async function raceCandidates(
  ml: ProbeMapModule,
  candidates: BaseCandidate[],
  opts?: { deadlineMs?: number; isCancelled?: () => boolean; onProbe?: (label: string, ok: boolean, ms: number) => void }
): Promise<{ label: string; style: MapStyleValue } | null> {
  const deadlineMs = opts?.deadlineMs ?? 30000;
  let won = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancelled = () => won || !!opts?.isCancelled?.();
  const tasks = candidates.map(async (c): Promise<{ label: string; style: MapStyleValue } | null> => {
    let style: MapStyleValue;
    try {
      style = await c.getStyle();
    } catch {
      return null;
    }
    if (cancelled()) return null;
    const t1 = Date.now();
    const ok = await probeCandidateFull(ml, style, { isCancelled: cancelled });
    const ms = Date.now() - t1;
    try { opts?.onProbe?.(c.label, ok, ms); } catch { /* ignore */ }
    if (ok && !cancelled()) {
      won = true;
      return { label: c.label, style };
    }
    return null;
  });
  try {
    return await new Promise<{ label: string; style: MapStyleValue } | null>((resolve) => {
      let settled = false;
      let done = 0;
      const finish = (v: { label: string; style: MapStyleValue } | null) => {
        if (settled) return;
        if (v) {
          settled = true;
          resolve(v);
          return;
        }
        done += 1;
        if (done >= tasks.length) {
          settled = true;
          resolve(null);
        }
      };
      for (const p of tasks) {
        p.then((r) => finish(r), () => finish(null));
      }
      timer = setTimeout(() => finish(null), deadlineMs);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Resolve when the map fires `load`, or after a timeout. Returns true if loaded, false if timed out. */
export function awaitMapLoad(
  map: { once: (ev: string, cb: () => void) => void; loaded?: () => boolean },
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    if (map.loaded && map.loaded()) {
      resolve(true);
      return;
    }
    let done = false;
    const ok = () => {
      if (!done) {
        done = true;
        resolve(true);
      }
    };
    const fail = () => {
      if (!done) {
        done = true;
        resolve(false);
      }
    };
    try {
      map.once("load", ok);
    } catch {
      resolve(false);
      return;
    }
    setTimeout(fail, timeoutMs);
  });
}

/** Console telemetry for tile diagnosis. */
export function logTile(stage: string, detail: string): void {
  try {
    // eslint-disable-next-line no-console
    console.info(`[pramaan-map] ${stage}: ${detail}`);
  } catch { /* ignore */ }
}
