# Map Tab

Case workspace tab (after Network Graph): MapLibre GL JS (bundled npm dep,
no extra install) + OpenFreeMap vector tiles (public instance, no API key).
All map data comes from the scoped `GET /api/cases/{id}/map/` endpoint —
pins never render from any other source.

## Layers

| Layer | Color | Source | Notes |
|---|---|---|---|
| Suspects | red | Person rows via latest dated `PRESENT_AT` → located place | Popup: Last Seen date + place |
| Device Location Pings | blue | Located Locations from CDR-type evidence | Tower-observed, not GPS |
| Cell Tower Pings | green | CDR tower-column mentions, city-fallback geocoded | Count = rows per (tower, date) |
| Hotspots (Density) | orange | Client-side heatmap over plotted pins (confidence-weighted) | Follows Layers/Filters live |
| 3D Buildings (OSM) | gray | Style's own `openmaptiles` vector source, all 3 styles | minzoom 13, pitch 60 on enable |
| Selected Area | violet | Drawn polygon copy | Draw Area flow |

Unlocated places are listed (not plotted). Disabled toggles always carry
their reason; cut items (Show My Location, Measure Distance) are not rendered.

## Movement Timeline

Selecting a suspect pin loads its dated trail (`GET map/movements/`) into
the bottom panel: play/pause, scrub handle, first→last date labels with a
current-date + position readout, and 0.5x/1x/2x/4x speed. The map draws the
visited path as a growing line with a current-position marker and follows
it in play and scrub alike. Only dated sightings animate (undated ones have
no timeline position); under two dated points the panel says so instead of
animating. Scrubbing pauses playback; reaching the end stops, and Play
replays from the start. Device/tower pins have no trails.

## Nearby search

The Filters tab's Nearby section answers "who was near here, then": pick a
center by clicking the map, set a radius (default 5 km) and reuse the date
window, Search. The map draws a true-distance disc (spherical-earth
destination points, verified to sit exactly 5.00 km out, matching the
backend haversine cutoff) with a center marker and violet hit pins; the
results list (person — place, distance, date) flies to each sighting on
click. Undated sightings match any window (same rule as the graph reads);
the run is scoped to the case like every other map endpoint.

## Pin correction

Device pins (Location entities) can be drag-corrected by editors: select
the pin → Move pin → drag the violet marker → release PATCHes
`latitude/longitude` + `geo_source: "manual"` (same validation as the
original `entity_locate`: Location-only, range-checked) and refreshes.
Esc/Cancel aborts without writing. Suspect pins move with their places;
tower points carry no entity record and are not draggable.

## Export Map View (court-ready evidence tie-in)

The Quick Actions panel's **Export Map View** button captures the current
map canvas (WebGL `toBlob`) and uploads it as a photo exhibit to a new
court-ready evidence package (`POST /api/reports/case-package/` with
`exhibit` + `exhibit_label`). The exhibit is stored with chain-of-custody entry, embedded as a §5 map
exhibit in the generated PDF, and captioned with its SHA-256 hash for
integrity.

**Flow:** click Export → canvas capture (up to 4 s timeout) → multipart
upload → toast with download link → PDF opens in new tab. The button is
disabled when the user lacks edit permission or while an export is
in-flight. Canvas capture runs inside a MapLibre `render` event to
guarantee the WebGL buffer is valid; if capture fails (timeout, empty
canvas, network error) a warning toast fires and no package is created.

Backend guards: exhibits must be PNG or JPEG ≤ 5 MB; any other type or
oversize file returns 400 with no evidence row leaking. The exhibit lands
in `Evidence` with `file_type="photo"` and a `ChainOfCustody` row, same
as any manually uploaded file.

## Known data-completeness limitations (measured 2026-09-14)

- **Building heights:** 58,223 OSM buildings in central Pune bbox; in the
  6 demo z14 tiles sampled, 106/106 carry `render_height` (spread 1–60 m —
  mixed tagged/derived provenance, small values likely approximations).
  Buildings with null height extrude to the **12 m default** (≈4 floors)
  rather than flat, so gaps read as intentional. Outside well-mapped areas
  the default dominates — treat extrusions as illustrative massing, never
  measurements.
- **Device vs tower:** blue pins are CDR-sourced (tower-observed); GPS-grade
  pings need a device feed (follow-up). Tower pins need tower columns in
  CDR evidence; hyphenated names ("Pune-Kothrud") inherit city coords with
  a `gazetteer-city` tag.
- **Tiles are offline-first with live upgrade:** the map mounts an
  all-local base instantly (dark tactical background, dashed reference
  graticule, bundled Natural Earth India state/country boundaries — public
  domain, vendored at `frontend/public/geo/`), so pins, heatmaps, trails and
  draw tools work in <1 s with zero network. Live tiles then upgrade in the
  background (`frontend/lib/mapStyles.ts`): every candidate races
  concurrently in its own hidden 256px probe map, and a win requires real
  `load` PLUS tile content (`areTilesLoaded()` — `load` alone fires on empty
  canvases, notably raster styles whose tiles then fail). First verified win
  swaps onto the visible map via a staging div (camera preserved, never
  blanked); losers self-clean; a 30 s deadline bounds the pass. All tile,
  font, sprite and TileJSON sub-requests go through MapLibre
  `transformRequest` → same-origin `/tiles/*` rewrites (`next.config.mjs`,
  flowing through nginx untouched), so the browser never touches a tile CDN
  directly. Candidates are all keyless (OpenFreeMap vectors via proxy →
  direct OpenFreeMap → OSM raster via proxy); CARTO is deliberately excluded
  because its tiles now require an API key and render watermarked without
  one. End states are always honest: `… · live` chip on success, amber
  "offline base" banner when every host fails (map stays fully usable).
  `[pramaan-map]` console lines log every attempt for diagnosis.
  3D buildings need a vector style and re-enable automatically after an
  upgrade remount.
  Tile degradation shows a non-blocking amber banner with the active base
  name + Retry; pins, heatmaps, trails and draw tools render even fully
  offline (only the photographic base layer is missing). A blocking
  "Map unavailable" overlay appears only if the map library itself fails.
  3D buildings need a vector style (OpenFreeMap/Carto); raster/offline
  styles report the toggle unavailable.
  Geocoding search uses Nominatim (rate-limited, best-effort).
