# Backend — Django App by App

Stack: Django 4.2 + DRF + SimpleJWT (access 30 min, refresh 1 day), Channels +
daphne, Celery + Redis. Global defaults (`config/settings.py`): JWT-only auth,
`IsAuthenticated` everywhere unless stated, page size 20, `SearchFilter` +
`OrderingFilter` + `DjangoFilterBackend` on case list (filter by
`status/risk_level/district/station`, search `fir_no/title/description`).

RBAC pattern used across apps (`apps/cases/permissions.py`):
`user_can_view_case` (SHO sees all; else owner or assignee),
`user_can_edit_case` (SHO, owner, or `edit`/`admin` assignment),
`visible_case_ids(user)` (`None` = SHO sees all), `IsSHO` permission class.
Enforcement is queryset filtering + per-object checks in views — see
[security-and-2fa](../features/security-and-2fa.md).

## accounts — users, roles, login, 2FA

Purpose: custom user + JWT auth + optional TOTP two-factor.

- **Models** (`models.py`): `User(AbstractUser)` + `role` (`sho` /
  `investigator` / `admin`, default investigator), `phone`,
  `totp_secret` (base32, set at setup), `totp_enabled` (bool, set after
  verify). `is_sho()` = role sho/admin or superuser.
- **Endpoints** (`/api/auth/`): `login/` (password step; returns
  `{two_factor_required, pre_token}` instead of tokens when 2FA is on —
  pre-token is a 5-minute JWT with `purpose: "2fa"`), `login/2fa/`
  (`{pre_token, code}` → real pair; 401 on bad code), `refresh/`, `me/`,
  `register/` (SHO-only user onboarding), `users/` (SHO-only list),
  `2fa/setup/` (authed; issues secret + `otpauth_url`), `2fa/verify/`
  (`{code}` → enables), `2fa/disable/` (requires password when enabled),
  `2fa/status/`.
- **TOTP** (`totp.py`): stdlib-only RFC 6238 (base32 secret, 30 s step,
  SHA-1, 6 digits, ±1 step skew, constant-time compare). No pyotp dependency.

## cases — case ownership, assignment, workflow

Purpose: the case as the authorization boundary; plus tasks/comments/links.

- **Models** (`models.py`, `models_workflow.py` — imported at the bottom of
  `models.py` so Django registers them): `Case` (`fir_no` unique, `title`,
  `description`, `status` open/under_investigation/pending_review/closed/
  archived, `risk_level` free-text default `"low"`, `station`, `district`,
  `owner` PROTECT, timestamps); `CaseAssignment` (case+user unique,
  `permission` view/edit/admin, `assigned_by`); `CaseTask` (title,
  description, assignee, created_by, status todo/doing/done, due_date);
  `CaseComment` (author, text); `CaseLink` (from/to case, reason, unique pair).
- **Endpoints**: `GET/POST /api/cases/` (SHO sees all; others owned/assigned;
  creator becomes owner), `GET/PATCH/DELETE /api/cases/{id}/` (edit-gated
  writes; **delete is SHO-only**), `POST {id}/assign/` (**IsSHO**;
  `{user_id, permission}`), `POST {id}/close/` (SHO-only; flips status to
  `closed` — ⚠️ Stub: the "archival + approval chain" mentioned in its
  docstring was never built), nested `tasks/`, `tasks/{id}/` (assignees may
  move their own status; editors full control; assignee must see the case),
  `comments/` + `comments/{id}/` (author-or-SHO delete),
  `links/` + `links/{id}/` (no self-links, no reverse duplicates, 409 on
  re-link; target must be visible), `activity/` (audit rows whose path
  contains `/api/cases/{id}/` merged with tasks + comments, newest 50).
- Case-scoped sub-routers for evidence/graph/geo live here too (`urls.py`);
  `EvidenceViewSet` and `GraphViewSet` are imported, not defined here.

## evidence — files, hashes, custody, pipeline entry

Purpose: evidence metadata + SHA-256 + chain-of-custody + RAG chunks; binary
lives in MinIO.

- **Models** (`models.py`): `Evidence` (case, `file_name`, `file_type`
  FIR/CDR/bank/witness/photo/transcript/document/other, mime, `size_bytes`,
  `sha256` indexed, `storage_key` = `cases/{case_id}/{uuid}_{safe_name}`,
  `uploaded_by`, `classification` + `classification_confidence`, `ocr_status`
  pending/processing/done/failed/unavailable/skipped, `ocr_text`,
  `ocr_pages`, `ocr_engine` raw-text/pypdf-text/paddleocr, `processing_error`,
  composite index on `(case, -created_at)`); `ChainOfCustody` (evidence
  **SET_NULL — never CASCADE** so trails survive file deletion,
  `evidence_snapshot` keeps file_name/sha256, actor/action/details/ip;
  `CustodyAction`: uploaded/viewed/downloaded/classified/ocr_completed/
  reprocessed/deleted; `log()` helper); `DocumentChunk` (evidence CASCADE,
  denormalized `case`, `chunk_index`, `text`, `embedding`
  `VectorField(dimensions=768, null=True)` for text-embedding-004, unique per
  evidence+index).
- **Upload flow** (`views.py::create`): multipart `file` → read bytes →
  MinIO `put_object` **inline** (on failure: record `processing_error`,
  keep metadata+hash, pipeline stages needing bytes defer) → `Evidence` row →
  `UPLOADED` custody entry → `process_evidence.delay()` → 201 with the row
  (pipeline results arrive via re-fetch/polling).
- **Endpoints** (nested under `/api/cases/{id}/`): `evidence/` list+upload,
  `evidence/{eid}/` detail (**logs VIEWED**) + DELETE (logs DELETED,
  best-effort MinIO delete), `custody/` (ledger), `download/` (presigned URL,
  default 1 h expiry, logs DOWNLOADED, 503 if store down), `reprocess/`
  (clears errors, re-queues pipeline, logs REPROCESSED).
- **Tasks** (`tasks.py`): `ingest_evidence` (verify object exists),
  `classify_file` (byte-sniff → classifier, logs CLASSIFIED),
  `run_ocr` (download → extract → store text/pages/engine),
  `index_evidence` (chunk + embed; embedding-free rows when no key),
  `process_evidence` orchestrator (ingest → classify → ocr → NER →
  relations → resolve → index). Stage contract: never raise — failures land
  on `processing_error`. See [ai-pipeline](ai-pipeline.md).
- **Commands**: `reindex --all | --fir FIR-…` (rebuild chunks).

## graph_api — extraction registry, review queue, Neo4j gateway

Purpose: Postgres review queue (system-of-record for extraction state) +
the **only** module allowed to touch Neo4j (`services/graph_service.py`).

- **Models** (`models.py`): `ExtractedEntity` (unique per
  case+type+normalized; `value`, `normalized`, `confidence`, `engine`
  regex/spacy/transformers, `status` pending/confirmed/rejected/merged,
  `mention_count`, `merged_into` self-FK, `graph_key` Neo4j link,
  `latitude/longitude/geo_source`, index on case+status);
  `ExtractedRelation` (unique per case+src+dst+type; `edge_type`,
  `confidence`, `snippet` evidence sentence, `engine`, `valid_from` date or
  NULL = undated, status); `MergeSuggestion` (entity_a/b ordered by id,
  `score`, `reason`, pending/approved/rejected, decided_by/at);
  `GraphSnapshot` (frozen `{nodes, edges}` + filters + counts for
  reports/diffs).
- **Services**: `extract.py` (regex phones/plates → spaCy NER → capitalized
  name fallback; alias-aware mentions; verb-pattern relations; date parsing);
  `resolve.py` (phone/plate anchors, initial-surname + fuzzy scoring,
  surname/initial blocking); `graph_service.py` (all Cypher — see
  [graph-layer](graph-layer.md)); `geo.py` (gazetteer, haversine, hotspots).
- **Endpoints**: `/api/entities/?q=&type=` (cross-case, access-scoped) +
  `/{id}/` (entity + `evidence_trail` of relations with snippets);
  `review/entities|relations|merges/` lists (`?case_id&status=`) + decide
  endpoints (`{confirm|reject}`, merge `{approve|reject}` — **approve is
  SHO-only**, 409 if already decided; relation-confirm at ≥0.60 confidence
  emits a CONNECTION alert); `review/entities/{id}/locate/` (PATCH coords,
  Location-only, range-checked); case-nested `graph/` (filters
  `types/min_confidence/date_from/date_to`; offline-Neo4j returns
  `live:false`), `graph/expand/?node=&depth=` (depth clamped 1–3),
  `graph/build/` (edit-gated; 503 if broker down), `timeline/`,
  `graph/snapshots/` (POST needs `label`; captures live graph),
  `snapshots/diff/?a=&b=`, `geo/`, `geo/movements/?person=`,
  `geo/nearby/?lat&lng&radius_km&date window`.
- **Tasks**: `extract_entities`, `extract_relations` (idempotent upserts),
  `resolve_entities` (new suggestions only), `build_temporal_graph`
  (CONFIRMED-only MERGEs + anomaly/risk alert fan-out, best-effort).
- **Commands**: `backfill_geo` (gazetteer-pin old Location rows).
- ⚠️ Stubs in this app: `GraphService.snapshot()/diff()` return canned
  dicts (real snapshots/diffs live in `views_snapshots.py`); `what_if()`
  returns `"impact": "not-computed"` and its view action exists but **no
  route maps to it** (same for the `snapshot`/`diff` view actions — dead
  code); `resolve.transliterate()` is a placeholder raising ImportError
  (IndicXlit not wired); `valid_to` is accepted but never populated;
  `MET_AT` edge type and `Event` nodes are defined but the extractor never
  emits them; `GraphViewSet` contains **two `timeline` definitions** — the
  second (unguarded, would 500 if Neo4j is down) shadows the first.

## analytics — GDS workup, risk, anomalies, districts

Purpose: read-only intelligence computed from the graph + registry.

- **Models**: `RiskReport` (case, created_by, `weights_version`, full
  per-factor `scores` JSON, node_count) — every risk computation persists
  one, making scores reproducible/auditable.
- **Services**: `gds.py` (per-case Cypher projection → degree undirected,
  confidence-weighted PageRank, directed betweenness, WCC + Louvain;
  bridges = multi-community links + shortest-path brokers; per-algorithm
  try/except with notes; projection always dropped); `risk.py` (v1 weights
  centrality .30 / brokerage .25 / connectivity .20 / cross_case .15 /
  evidence .10; levels high ≥.60, medium ≥.35); `anomalies.py`
  (hub z>2 with n≥4, ≥3 same-date edges burst, community mean conf <.5 with
  ≥2 edges); `crosscase.py` (shared entities across ≥2 *visible* cases only).
- **Endpoints** (`/api/analytics/`): `case/{id}/overview/` (top-15 players,
  bridges, communities, engine + notes), `case/{id}/risk/` (scores +
  auto-saved report id), `case/{id}/risk/history/`,
  `case/{id}/anomalies/`, `case/{id}/compare/?from=&to=` (date-based
  what-changed), `cross-case/`, `districts/`, `district/?district=`
  (caseload/risk splits, workload, weekly growth, cross-case top). GDS
  failures surface as 503, never fake numbers.

## copilot — intent-routed investigation QA

Purpose: natural-language answers grounded in graph + retrieval. No LLM is
needed for routing or for path/summary answers.

- **Flow** (`views.py::query`, POST `{question ≤1000 chars, case_id?}`):
  scope check first → `intents.classify` (regexes: path forms like “how is
  X connected to Y” / “A → B”; summary words; else generic) → one of three
  answerers, every answer carrying citations.
- **Services**: `intents.py` (router), `retrieval.py` (hybrid: pgvector
  cosine top-k when embeddings exist, then postgres full-text
  `websearch` rank to fill `RAG_TOP_K=6`; sqlite/icontains fallback),
  `gemini.py` (`google-genai` SDK; `embed_texts` per-item-None on failure,
  `generate` grounded; `GeminiUnavailable` drives honest degradation),
  `chunking.py` (sentence-aware ~800-char chunks, ~100 overlap).
- Path answers use Neo4j `shortestPath` (≤4 hops) verbalized hop-by-hop;
  unconfirmed endpoints get a "confirm it first" answer, never a guess.
  Without `GEMINI_API_KEY`, generic answers are extractive and labeled
  `generated: false`.

## search — one scoped query across everything

Purpose: `GET /api/search/?q=&type=&case_id=&limit=` (q needs ≥2 chars,
limit clamped 1–50 default 10) returning grouped `{entities, evidence,
cases}`. Postgres: trigram similarity (>0.15) OR icontains for names/files,
full-text rank for OCR text; elsewhere icontains. Case filter must itself
be visible (else 403/404).

## system — ops health

Purpose: `GET /api/health/` (**unauthenticated by design**, no sensitive
data): per-dependency ok/ms/detail for Postgres, Redis, Neo4j, MinIO;
overall 503 when anything is down.

## alerts — deduped events, rules, realtime fan-out

Purpose: case-level `Alert` feed (dedupe_key, 24 h window) + per-user
`Notification` delivery + `AlertRule` routing (kind/severity/confidence/
case, enabled, email_digest) + `ws/alerts/` JWT sockets (`user_{id}`
groups, `hello` handshake, `alert.message` frames, close 4401 on bad token).

- **Emission** (`services.py::emit_event`): dedupe → Alert row → matching
  enabled rules whose user sees the case (cross-case refs require seeing
  *all* involved cases) → Notification + `broadcast()` (async_to_sync
  group_send, failure only logged). Callers: relation-confirm ≥0.60,
  post-build anomaly/risk checks, cross-case extraction matches.
- **Endpoints** (`/api/alerts/`): scoped feed (`?kind&severity`),
  `notifications/` (`?unread=1&channel=`), `notifications/{id}/read/`,
  `read-all/`, `rules/` CRUD (personal queryset — others' rules 404).
- **Commands**: `send_digest` (mocked 24 h email digests for opted-in users;
  prints + stores `email_mock` rows — ⚠️ Stub: no real SMTP).

## reports — court-ready PDF packages

Purpose: `Report` row (case, kind, MinIO key, sha256, size, author) +
`services/package.py` (reportlab platypus: cover, evidence manifest with
truncated hashes, per-file custody ledger, confirmed findings, full hash
manifest). `POST case-package/ {case_id}` (edit-gated) builds sync, stores
to `reports/case_{id}/…` with a 7-day presigned `download_url`, 201;
`{id}/download/` streams the bytes; list is visibility-scoped with
`?case_id=`.

## auditlog — immutable trail + the activity feed source

Purpose: `AuditLog` (actor, action, object_type=**request path**,
object_id always `""`, before always `{}`, after only `{status}`,
timestamp indexed, ip). `AuditLogMiddleware` logs every POST/PUT/PATCH/
DELETE under `/api/` except `/api/audit/` itself — best-effort (never
breaks requests). Read-only list is **SHO-only**. Case `activity/` feed
reuses these rows by path substring. (Honesty note: "before/after state"
in the model docstring overstates it — only the response status is kept.)

## cases/permissions.py + apps/security.py + apps/admin_register.py

- `permissions.py`: `IsSHO`, `user_can_view_case`, `user_can_edit_case`,
  `visible_case_ids` — the single RBAC home everything imports.
- ⚠️ Stub: `apps/security.py` (`encrypt_str`/`decrypt_str`, Fernet AES) is
  **defined but never imported anywhere** — no model field is encrypted at
  rest today. `FIELD_ENCRYPTION_KEY` is read but unused.
- ⚠️ Dead code: `apps/admin_register.py` (414 bytes) is never imported;
  per-app `admin.py` files do the real registration.
