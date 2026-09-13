# API Endpoints

Generated from `config/urls.py` + each app's `urls.py`/views (not from
memory). Auth: JWT Bearer unless noted. Pagination: `{count, next,
previous, results}` (page size 20) on DRF list views; `@api_view`
function endpoints return raw lists/objects.

Conventions: `403` = valid login, not your case · `404` = unknown id ·
RBAC helpers in `apps/cases/permissions.py` · audit middleware logs every
mutating call (see [security-and-2fa](../features/security-and-2fa.md)).

## Auth — `/api/auth/`

| Method + path | Auth | Body → Response |
|---|---|---|
| `POST login/` | open | `{username, password}` → `{access, refresh}` **or** `{two_factor_required: true, pre_token}` (5-min `purpose:"2fa"` JWT) |
| `POST login/2fa/` | pre-token | `{pre_token, code}` → `{access, refresh}`; 401 bad/expired |
| `POST refresh/` | refresh JWT | `{refresh}` → `{access}` |
| `GET me/` | ✓ | → `{id, username, email, role, phone, first_name, last_name}` |
| `POST register/` | SHO | `{username, email, password≥8, role, phone, …}` → user, 201 |
| `GET users/` | SHO | → up to 200 users |
| `POST 2fa/setup/` | ✓ | → `{secret, otpauth_url}` (stored, not yet enabled) |
| `POST 2fa/verify/` | ✓ | `{code}` → `{totp_enabled: true}`; 400 wrong code |
| `POST 2fa/disable/` | ✓ | `{password}` (checked while enabled) → `{totp_enabled: false}` |
| `GET 2fa/status/` | ✓ | → `{totp_enabled}` |

## System / docs

| Method + path | Auth | Notes |
|---|---|---|
| `GET /api/health/` | **none** | `{status, time, checks: {db, redis, neo4j, minio: {ok, ms, detail}}}`; 503 if any down |
| `GET /api/schema/` · `/api/docs/` | ✓ (docs login) | OpenAPI + Swagger (⚠️ info block still says "0.1.0 (Phase 1)") |

## Cases — `/api/cases/`

| Method + path | Auth | Notes |
|---|---|---|
| `GET /` | ✓ | SHO: all. Others: owned ∪ assigned. `?status=&risk_level=&district=&station=`, `?search=` (fir/title/description), `?ordering=`. List rows carry `entities_count, evidence_count, alerts_count, relations_count` |
| `POST /` | **SHO** | `{fir_no (unique), title, description, status, risk_level, station, district, state}` → owner = you; 403 otherwise |
| `GET /{id}/` | view | Includes nested `owner` + `assignments[]` (+ the same four counts) |
| `POST /cases/icjs-import/ {external_case_id}` | **SHO** | Creates the case from the ICJS manifest (title/fir_no/station/district/state, owner = you) then imports the bundle: 409 duplicate FIR, 422 manifest without fir_no, 404 unknown external id, 502 unreachable service. Total failure deletes the fresh empty case (log row survives, `case_id: null`) |
| `PUT/PATCH /{id}/` | edit | 403 otherwise |
| `DELETE /{id}/` | **SHO** | Assignments CASCADE |
| `POST /{id}/assign/` | **IsSHO** | `{user_id, permission: view\|edit\|admin}` → upsert |
| `POST /{id}/close/` | SHO | Flips `status` → `closed` (⚠️ no archival flow) |

## ICJS import

| Method + path | Auth | Notes |
|---|---|---|
| `GET /api/icjs/available-cases/` | **SHO** | Proxies the mock service list (`case_id, title, state, district`); 502 if unreachable; 403 otherwise |

## Evidence — `/api/cases/{id}/evidence/…` (all case-scoped)

| Method + path | Auth | Body → Response |
|---|---|---|
| `GET /` | view | Evidence rows (newest first) |
| `POST /` | **investigator-only** (`user_can_contribute_case`: assigned investigator, never SHO) | multipart `file` (+optional `file_name`, `file_type`) → 201 row; inline MinIO put, `UPLOADED` custody entry, `process_evidence.delay()`; store-down degrades to `processing_error` |
| `GET /{eid}/` | view | Row (**logs VIEWED**) |
| `DELETE /{eid}/` | edit | Logs DELETED, best-effort MinIO delete |
| `GET /{eid}/custody/` | view | `[{action, actor, details, evidence_snapshot, ip, timestamp}]` |
| `GET /{eid}/download/` | view | `{url (1 h presigned), file_name, sha256}`; logs DOWNLOADED; 503 if store down |
| `POST /{eid}/reprocess/` | edit | Resets errors, re-queues pipeline |

Evidence row: `id, case, file_name, file_type, mime_type, size_bytes,
sha256, storage_key, uploaded_by, classification,
classification_confidence, ocr_status, ocr_pages, ocr_engine,
processing_error, created_at, updated_at` (all but name/type/mime read-only).

## Graph — `/api/cases/{id}/graph/…`, `/timeline/`

| Method + path | Auth | Notes |
|---|---|---|
| `GET graph/` | view | `{nodes[], edges[], filters?}`; `?types=A,B` (alias `node_types`), `?min_confidence=`, `?date_from=&date_to=` (undated edges always pass); Neo4j down → `{nodes:[], edges:[], live:false}` |
| `GET graph/expand/?node=&depth=` | view | 1–3-degree neighborhood (clamped); 400 without `node`; 503 if Neo4j down |
| `POST graph/build/` | edit | Queues `build_temporal_graph` → `{build: "queued"}`; 503 if broker down |
| `GET timeline/` | view | Dated edges oldest-first |
| `GET/POST graph/snapshots/` | view / edit | POST needs `{label}` (+ optional filters) → 201 frozen `{nodes, edges}` + counts |
| `GET graph/snapshots/diff/?a=&b=` | view | `{nodes:{added,removed}, edges:{added,removed}}` by stable id |
| `GET/DELETE graph/snapshots/{sid}/` | view / edit | Detail includes `data`; delete → 204 |
| workflow: `tasks/` GET/POST, `tasks/{id}/` PATCH/DELETE; `comments/` GET/POST, `comments/{id}/` DELETE; `links/` GET/POST, `links/{id}/` DELETE; `activity/` GET | view; writes need edit (assignees may move own task status; comment delete = author or SHO; link create needs target visible, rejects self/reverse-dup 409/400) | Task create validates assignee sees the case |

> Geo HTTP endpoints (`geo/`, `geo/movements/`, `geo/nearby/`, `locate/`) were
> removed — no map UI. Gazetteer auto-pinning at extraction stays.

## Entities & review — `/api/entities/…`

| Method + path | Auth | Notes |
|---|---|---|
| `GET ?q=&type=` | ✓ | Cross-case, visibility-scoped; empty q → `{results: []}` |
| `GET /{id}/` | ✓ (scoped) | `{entity, evidence_trail[]}` (relations with snippets) |
| `GET review/entities/?case_id&status=` | view | Pending queue (default filter in UI) |
| `GET review/relations/?case_id&status=` | view | With src/dst values + snippets |
| `POST review/relations/{id}/` | **investigator-only** | Confirm at conf ≥0.60 emits CONNECTION alert (high if ≥0.80) |
| `GET review/merges/?case_id&status=` | view | Score-ordered suggestions |
| `POST review/merges/{id}/ {approve\|reject}` | edit; **approve = SHO** | Approve repoints relations (folds on conflict, drops self-loops), APOC-merges graph nodes best-effort; 409 if already decided |

## Analytics — `/api/analytics/…` (all view-scoped; GDS failure → 503, never fake data)

`case/{id}/overview/` (top-15 players, bridges, communities, engine+notes) ·
`case/{id}/risk/` (scores + factor breakdown, auto-saves `RiskReport`) ·
`case/{id}/risk/history/` · `case/{id}/anomalies/` ·
`cross-case/` (≥2 mutually-visible cases) · `districts/` · `district/?district=`
(requires the param; aggregates only).

## Copilot / search

- `POST /api/copilot/query/` (✓): `{question ≤1000 chars, case_id?}` →
  `{question, intent: path|summary|generic, answer, citations[]:
  {evidence_id, file_name, case_fir?, snippet, score?, method?}, generated,
  model?, vector_used?}`. 400 empty question; 403 out-of-scope case.
- `GET /api/search/?q=&type=&case_id=&limit=` (✓): q needs ≥2 chars (else
  empty groups); limit clamped 1–50 (default 10); case filter must be
  visible; → `{query, entities[], evidence[] (file meta + 220-char text
  head), cases[]}`.

## Alerts — `/api/alerts/…`

`GET /` (visibility-scoped feed, `?kind&severity`) · `GET notifications/`
(mine, `?unread=1&channel=`) · `POST notifications/{id}/read/` (own only,
else 404) · `POST notifications/read-all/` → `{marked}` ·
`rules/` GET/POST + `rules/{id}/` GET/PATCH/DELETE (personal queryset).
Realtime: `ws/alerts/?token=<access-JWT>` → `hello`, then
`{type:"alert", …}` frames; bad token → close 4401.

## Reports / audit

- `GET /api/reports/` (scoped, `?case_id=`) · `POST /api/reports/case-package/
  {case_id}` (edit) → 201 `{…, download_url (7-day presigned)}`; 500 build
  failure, 503 store down · `GET /api/reports/{id}/download/` streams the PDF.
- `GET /api/audit/` (read-only): SHO sees all; investigators see only rows
  where they are the actor. Shape: `{actor, action, object_type
  (request path), object_id (always ""), before (always {}), after
  ({status}), timestamp, ip}`.
