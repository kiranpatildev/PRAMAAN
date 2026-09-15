# AI Handoff — PRAMAAN Development Context

## Current Project Status

Map Tab Step 2 (Items 8–15) is **fully complete and verified** as of
2026-09-15. Full suite: **255/255 backend tests OK**, `tsc --noEmit` clean,
ESLint clean, `next build` clean.

## Completed Items

| Item | Feature | Status |
|------|---------|--------|
| 1 | Map Tab MVP (MapLibre GL JS + OpenFreeMap, real pins, layers, filters) | ✅ |
| 8 | Draw Area → Isolate (`?tab=network&isolate=keys`) | ✅ |
| 9 | Towers + heatmap (cell tower pins, client-side density) | ✅ |
| 10 | 3D buildings (`buildings-3d`, coalesce 12m default, pitch 60) | ✅ |
| 11 | Movements timeline (`GET map/movements/`, play/pause/scrub/speed) | ✅ |
| 12 | Nearby search (`GET map/nearby/`, disc visualization, results) | ✅ |
| 13 | Pin correction (`PATCH entities/{id}/locate/`, drag-pin, manual source) | ✅ |
| 14 | District choropleth (`GET /api/analytics/districts/geo/`, `DistrictMap.tsx`) | ✅ |
| 15 | Export Map View → court-ready evidence package (canvas capture + exhibit upload) | ✅ |

Also complete from prior phases:
- Part 1 integrity pass
- Multilingual extraction (170/170 OK)
- NL-to-Cypher slices 1–4 (230/230 OK, eval 30/30 keyless)

## Files Changed — Item 15

| File | Change |
|------|--------|
| `backend/apps/reports/services/package.py` | Added `_exhibit_image()` (canvas→PNG fit-width with SHA-256 hash caption), expanded `build_evidence_package()` with §5 map exhibit section; `MAX_EXHIBIT_BYTES=5MB`, `EXHIBIT_MIMES` whitelist |
| `backend/apps/reports/views.py` | `case_package` view now accepts multipart `exhibit` + `exhibit_label` fields; validates type/size, creates evidence via `create_evidence(file_type="photo")` |
| `backend/apps/cases/tests_phase7.py` | Added `test_package_with_map_exhibit` (PNG→evidence→PDF §5 embed, custody row) and `test_package_exhibit_validation` (bad type 400, oversize 400, no evidence leak) |
| `frontend/components/case/MapTab.tsx` | `MapCanvas` accepts `captureSignal` (increment counter) + `onCapture(blob)` props; `MapTab` manages capture state, `exportView()` increments signal, `onCapture()` calls `generatePackage()` with blob; Export button wired |
| `frontend/lib/endpoints.ts` | `generatePackage()` accepts optional `{ blob, label }`; builds `FormData` with `case_id` + `exhibit` + `exhibit_label` instead of plain JSON when blob provided |
| `docs/features/map-tab.md` | Added "Export Map View (court-ready evidence tie-in)" section |
| `docs/api/endpoints.md` | Updated `POST /reports/case-package/` to document multipart exhibit params and 400 guard |
| `docs/testing/test-coverage.md` | 253→255 total, `cases/tests_phase7.py` 8→10 with exhibit test descriptions |

## Files Changed — Prior Items (Map Tab)

| File | Items |
|------|-------|
| `backend/apps/graph_api/views_map.py` | 1, 9, 11, 12, 13 |
| `backend/apps/cases/urls.py` | 1, 11, 12, 13 |
| `backend/apps/graph_api/services/geo.py` | 1, 9, 12 |
| `backend/apps/analytics/views.py` | 14 |
| `backend/apps/analytics/urls.py` | 14 |
| `frontend/components/case/MapTab.tsx` | 1, 8–13, 15 |
| `frontend/components/district/DistrictMap.tsx` | 14 |
| `frontend/app/(app)/districts/page.tsx` | 14 |
| `frontend/app/(app)/cases/[id]/page.tsx` | 1 |
| `frontend/components/case/CaseTabs.tsx` | 1 |
| `frontend/lib/endpoints.ts` | 11, 12, 13, 14, 15 |

## Tests and Verification

| Check | Result |
|-------|--------|
| `python manage.py test` (full suite) | **255/255 OK** (220s) |
| `apps.cases.tests_phase7.ReportTests` (verbose) | **5/5 OK** — includes both exhibit tests |
| `npx tsc --noEmit` | Clean |
| `npx eslint MapTab.tsx endpoints.ts` | Clean |
| `npx next build` | Clean (all routes compiled) |

Test environment: `DATABASE_URL=postgres://pramaan:pramaan@localhost:5433/pramaan`, `CELERY_EAGER=1`.

## Known Limitations

- **Canvas capture is lossy:** WebGL `toBlob()` produces PNG/JPEG — no vector export. Pixel density depends on device DPR; 4s timeout may fail on very slow machines.
- **No multi-exhibit in one click:** each Export creates one exhibit + one package. Chaining multiple map screenshots requires multiple clicks.
- **Exhibit label defaults to filename** if user doesn't change it — may be vague in court packages.
- **Building heights:** 58,223 OSM buildings in central Pune bbox; null heights extrude to 12m default. Treat as illustrative, never measurements.
- **Device vs tower:** blue pins are CDR-sourced (tower-observed); GPS-grade pings need a device feed (follow-up).
- **Tiles need network:** OpenFreeMap has no offline fallback; tile failure shows explicit overlay.

## Architectural Decisions

1. **Canvas capture timing:** `MapCanvas` uses `captureSignal` (increment counter) not a boolean — re-clicks trigger re-capture. Actual capture runs inside `map.once("render")` + `triggerRepaint()` to ensure the WebGL buffer is valid. Don't change to a one-shot pattern.

2. **FormData auto-detection:** `apiFetch` in `frontend/lib/api.ts:112-114` auto-detects `FormData` and omits `Content-Type` (lets browser set multipart boundary). `generatePackage` relies on this — don't add explicit `Content-Type` headers.

3. **Exhibit flows through existing evidence pipeline:** uploaded PNG goes through `create_evidence(file_type="photo")` → classification → storage → chain-of-custody, same as any manual upload. PDF builder picks it up as `§5 MAP EXHIBITS`. Don't create a separate exhibit path.

4. **No model/LLM involvement in capture:** the entire canvas→blob→upload→PDF chain is synchronous/frontend-driven with no AI. Don't add AI classification or embedding to the export flow.

5. **Map data scoping:** all map endpoints use `visible_case_ids()` — no exceptions. Pins never render from any unsourced endpoint.

6. **`geo_source` is undifferentiated:** `gazetteer`/`gazetteer-city`/`manual`/`""`. Layers are derived (suspects=Person via latest `PRESENT_AT`, device=located Locations from CDR evidence, towers=CDR tower-column mentions). No new `geo_source` values.

7. **Backend startup checks:** use `wait_backend.py` (`/api/health/`) and `wait_pg.py`; verify PID/cmdline before kill. Fixed sleeps are banned.

8. **NL-to-Cypher:** verifier-before-execution mandatory, `GraphService.run_readonly` only sanctioned path, scope injection + LIMIT 100 + 10s timeout, one temp-0 LLM call/question.

9. **Multilingual:** `extract_for_evidence()` router, trusted Indic→`indic-ner`, English frozen, unsupported→`unsupported_language` zero rows.

## Standing Development Rules

- No placeholder/interactive-but-unwired UI — every frontend element must connect to a real backend endpoint.
- Every map endpoint scoped to `visible_case_ids()`.
- Honest degradation — tile failure shows overlay; capture failure shows toast; no silent failures.
- Test after each slice (backend `manage.py test`, frontend `tsc --noEmit` + `next build` + ESLint).
- Stop for confirmation after each Step 2 item.
- No new CARTO fallback — OpenFreeMap only.
- No Show My Location or Measure Distance.
- Draw Area uses Terra Draw + Turf.js.
- `CELERY_EAGER=1` required for tests.

## Next Planned Item

Step 2 is complete. No next item is queued. Await further instructions.
