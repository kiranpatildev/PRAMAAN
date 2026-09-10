# PRAMAAN — AI-Powered Criminal Network Analysis System

Evidence-backed, temporal knowledge graph for criminal investigations.
Phase 1 scope: `docker compose up` gives a working login + empty dashboard.

## Quickstart

```powershell
Copy-Item .env.example .env
docker compose up --build
```

- App (nginx): http://localhost:8080
- Frontend dev: http://localhost:3000
- Backend API: http://localhost:8000/api/
- Neo4j browser: http://localhost:7474 (neo4j / see .env)
- MinIO console: http://localhost:9001

> Host port remaps: Postgres is on **5433** and Redis on **6380** (a locally
> installed Postgres/Redis may already own 5432/6379). Containers are
> unaffected (they use `db:5432` / `redis:6379` internally). For host-side dev
> (runserver, manage.py, celery on your machine), export:
> ```powershell
> $env:DATABASE_URL="postgres://pramaan:pramaan@localhost:5433/pramaan"
> $env:REDIS_URL="redis://localhost:6380/0"
> ```

Demo users (created by `seed_demo` on backend start):

| role | username | password |
|------|----------|----------|
| SHO | sho_demo | Pramaan123! |
| Investigator | inv_demo | Pramaan123! |

## Repo layout

```
docker-compose.yml  postgres+postgis+pgvector, neo4j+GDS, redis, minio, backend, worker, frontend, nginx
backend/            Django + DRF + SimpleJWT + RBAC, apps: accounts/cases/evidence/graph_api/analytics/copilot/alerts/reports/auditlog
frontend/           Next.js 14 App Router + TS + Tailwind, Cytoscape/vis/map stubs behind feature flags
nginx/              reverse proxy (:8080 -> frontend :3000, /api/ -> backend :8000)
infra/postgres/     postgis + pgvector image
```

## API (Phases 1–2)

```
/api/auth/login|refresh|me
/api/cases/  CRUD + ?status=&risk=  (SHO sees all; investigator sees assigned)
/api/cases/{id}/assign/  (SHO/admin only: {user_id, permission})
/api/cases/{id}/evidence/  multipart upload -> MinIO + sha256 -> Celery pipeline
/api/cases/{id}/evidence/{eid}/  detail (logs custody VIEWED) + DELETE
/api/cases/{id}/evidence/{eid}/custody/   chain-of-custody ledger
/api/cases/{id}/evidence/{eid}/download/  presigned MinIO URL (logs DOWNLOADED)
/api/cases/{id}/evidence/{eid}/reprocess/ retry pipeline (clears errors, logs REPROCESSED)
/api/cases/{id}/graph/  stub nodes/edges + snapshot/diff/what-if placeholders
/api/entities/  search stub (Phase 3: real NER/Neo4j)
/api/analytics/  stub (Phase 5: GDS)
/api/copilot/  stub (Phase 6: pgvector + Gemini RAG)
/api/alerts/  stub list
/api/reports/  stub
/api/audit/  read-only (SHO/admin)
```

## Ingestion pipeline (Phase 2)

```
POST bytes -> sha256 -> MinIO put (inline) -> Evidence row -> custody(UPLOADED)
    -> process_evidence.delay: ingest verify -> classify_file -> run_ocr
```

- `apps/evidence/services/storage.py` — MinIO/boto3 wrapper (fail-fast timeouts).
- `apps/evidence/services/classifier.py` — FIR/CDR/bank/witness/photo/transcript
  heuristics from content markers -> filename -> extension, with confidence.
- `apps/evidence/services/ocr.py` — `raw-text` / `pypdf-text` engines now;
  PaddleOCR lazily (heavy deps in `requirements-ml.txt`; scanned images report
  `unavailable`, never fake text). `ocr_text` feeds Phase 3 NER + Phase 6 RAG.
- A stage never raises: failures land on `Evidence.processing_error` and the
  pipeline can be retried via `/reprocess/`. `ChainOfCustody` ledger (SET_NULL,
  never CASCADE) records uploaded/viewed/downloaded/classified/ocr_completed/
  reprocessed/deleted per file.

## Extraction pipeline (Phase 3)

```
ocr_text -> extract_entities (regex phones/plates + spaCy NER + name fallback)
         -> review queue (PENDING) -> investigator confirm/reject
         -> extract_relations (verb-pattern typed edges + snippets)
         -> resolve_entities (blocking + scored MergeSuggestions)
         -> build_temporal_graph (CONFIRMED rows -> Neo4j MERGEs)
         -> SHO-approves-merge (APOC node fold, relations repointed)
```

- `apps/graph_api/services/extract.py` — deterministic regex extractors own
  phones/plates (spaCy DATE-noise suppressed); `en_core_web_sm` for
  PERSON/ORG/LOC; capitalized-name fallback + alias-aware mentions
  ("Rahul owns ..." resolves to Rahul Sharma only when unambiguous).
  IndicBERT/HF NER plugs in behind the same contract (requirements-ml.txt).
- `apps/graph_api/services/resolve.py` — phone/plate anchors (1.0),
  initial-surname ("R. Sharma" ~ "Rahul Sharma", 0.80), fuzzy names;
  persons block on (surname, initial) so variants meet.
- `GraphService` does real Cypher (key = `{case}:{type}:{normalized}`,
  every node/edge carries source_evidence_id, confidence_score, extracted_by,
  extracted_on, valid_from/valid_to). Reads tolerate APOC-combine list props.
- Review API: `/api/entities/review/entities|relations|merges/` + decide
  endpoints; merge approve is SHO-only; `/api/cases/{id}/graph/build/`
  rebuilds from confirmed rows. `seed_demo` ships statements exercising the
  whole flow (case 1 pre-built into Neo4j).

## Graph explorer (Phase 4)

- `GET /api/cases/{id}/graph/?types=Person,Vehicle&min_confidence=0.6&date_from=2026-03-01&date_to=2026-03-31`
  — server-side type/confidence/date filters (undated edges always pass).
- `GET /api/cases/{id}/graph/expand/?node={key}&depth=2` — 1–3 degree
  neighborhood merged into the canvas client-side.
- `GET /api/cases/{id}/timeline/` — event sequence from dated edges.
- Snapshots (Postgres-frozen views for reports): `GET|POST
  /api/cases/{id}/graph/snapshots/`, `GET|DELETE .../snapshots/{sid}/`,
  `GET .../snapshots/diff/?a=&b=` (added/removed nodes + edges).
- Temporal layer: `parse_dates()` anchors relations to explicit sentence
  dates (`valid_from`); no inference, undated stays NULL.
- UI: filter toolbar (debounced), enriched Why-panel (source doc metadata +
  extraction provenance + expand control), snapshot save/load/compare,
  chronological event list.

## Analytics layer (Phase 5)

- `GET /api/analytics/case/{id}/overview/` — GDS 2.x workup (per-case
  projection): degree, confidence-weighted PageRank, betweenness, WCC +
  Louvain communities, inter-community bridges/brokers. Engine reported;
  failing algorithms omit with notes, never fake numbers.
- `GET /api/analytics/case/{id}/risk/` — explainable score (centrality 0.30,
  brokerage 0.25, connectivity 0.20, cross-case 0.15, evidence 0.10; v1
  weights) with per-factor breakdown; every computation persists a
  `RiskReport` audit row. `.../risk/history/` lists past assessments.
- `GET /api/analytics/case/{id}/anomalies/` — hub outliers (z>2),
  contact bursts (≥3 same-date edges), weak-evidence communities.
- `GET /api/analytics/cross-case/` — entities in ≥2 mutually-visible cases
  (hidden cases never leak, not even as counts).
- `GET /api/analytics/case/{id}/compare/?from=&to=` — date-based what-changed.
- UI: analytics workbench (key players + factor tooltips, bridges,
  anomalies, risk overlay on graph), investigation replay slider (edges
  emerge at valid_from), cross-case panel on dashboard, date compare.

## Copilot & search (Phase 6)

- RAG index: `DocumentChunk` (evidence text → ~800-char chunks, pgvector
  768d). `process_evidence` auto-indexes; `python manage.py reindex --all`
  backfills. Embeddings are key-optional — without `GEMINI_API_KEY`, chunks
  serve keyword retrieval and the copilot answers extractively (labeled).
- `POST /api/copilot/query/` — intent-routed: connection questions answered
  from Neo4j shortestPath (hop-by-hop evidence, no LLM needed), summaries
  from GDS + risk rollups, everything else via hybrid retrieval (vector +
  full-text) with Gemini-grounded generation when configured. Set
  `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, `RAG_TOP_K`) in `.env`.
- `GET /api/search/?q=&type=&case_id=` — grouped entities/evidence/cases
  with trigram typo tolerance + full-text rank, strictly case-scoped.
- UI: copilot chat on the case page (suggested questions, cited turns),
  global `/search` page linked from the header.
- Infra note: the db image vendors pgvector .debs offline
  (`infra/postgres/debs/`, see SOURCES.txt) — rebuild-safe on slow links.
  Tests need Postgres (`DATABASE_URL` to :5433) for vector/trigram paths.

## Supporting modules (Phase 7)

- **Alerts (realtime):** `emit_event()` fan-out on high-confidence confirms,
  anomaly/risk post-build checks, and cross-case extraction matches —
  deduped (24h), rule-routed (`AlertRule`: kind/severity/confidence/case),
  pushed over `ws/alerts/` (JWT, daphne + redis channel layer, `/ws/`
  proxied by nginx) to per-user groups. `Notification` rows back the bell;
  `manage.py send_digest` composes mocked email digests for opted-in users.
  The case alert feed is scoped to visible cases.
- **Geo:** built-in Indian-city gazetteer auto-pins Locations at extraction
  (`backfill_geo` for older rows); investigators pin the rest
  (`PATCH review/entities/{id}/locate/`). Endpoints: `cases/{id}/geo/`
  (points + grid hotspots), `geo/movements/` (dated PRESENT_AT trails),
  `geo/nearby/` (haversine + date window). MapLibre UI with movement lines.
- **Reports:** `POST /api/reports/case-package/` builds the court-ready PDF
  (manifest + SHA-256 + custody ledger + findings), stored in MinIO with a
  `Report` row; download endpoint streams it back.
- **District analytics:** `GET /api/analytics/districts/` +
  `district/?district=` (caseload, risk split, workload, weekly growth,
  cross-case top) with a dashboard panel.
- **Workflow:** tasks (assignee must see the case), comments (author/SHO
  delete), formal case links (no self/reverse dups), and a unified
  `/activity/` feed (audit trail + tasks + comments).
- UI: alerts bell with live toasts, `/alerts` center (feed/notifications/
  rules/digests), geo map, reports card, workflow tabs, district panel.
- Ops notes: backend serves via **daphne** (runserver cannot do WS — use
  daphne for local WS dev too); frontend mounts source dirs only so image
  dependency updates are never shadowed by stale volumes.

## Polish (Phase 8)

- **2FA (TOTP, stdlib-only):** setup → verify → pre-token login flow
  (`/api/auth/2fa/*`), login UI second step, dashboard security card.
  Seed resets demo 2FA state so demo logins keep working.
- **Themes:** dark command-center default + light mode (CSS-variable tokens
  with a utility remap), persisted toggle, no-flash pre-hydration script.
- **Responsive/mobile:** wrapping header, stacked grids, adaptive graph/map
  heights, viewport-safe dropdowns. PWA-installable (`manifest.webmanifest`
  + icons); offline banner + IndexedDB evidence-upload outbox with retry.
- **i18n:** EN/HI toggle (progressive `t(key, fallback)` — untranslated
  strings stay English) across header, login, dashboard, and case surfaces.
- **Seed:** 4 users, 6 district-spread cases (incl. a closed one), multi-kind
  evidence (shared cross-case phone), CDR rows, workflow rows, case link,
  best-effort MinIO upload — fully idempotent across re-runs.
- **Perf/security:** `/api/health/` (db/redis/neo4j/minio + latency),
  composite indexes on hot filters (review queue, bell, feeds, audit),
  nginx hardening headers + dynamic DNS upstreams (no stale-IP 502s),
  SECRET_KEY production warning. Measured: me 22ms, cases 67ms, search 86ms.

## Design principles (non-negotiable)

Every graph edge/node carries `source_evidence_id`, `confidence_score`,
`extracted_on`, `valid_from/valid_to`. The graph-write layer lives behind
`graph_api/services/graph_service.py` — never scatter Neo4j queries in views.
Each AI stage is a separate Celery task with typed in/out contracts
(`evidence/tasks.py` + `graph_api/tasks.py` stubs in Phase 1).
Every AI claim in UI shows a "Why?" affordance opening the evidence panel.
