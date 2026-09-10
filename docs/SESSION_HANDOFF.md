# SESSION HANDOFF — PRAMAAN

**Date:** 2026-09-10 (session close)
**Status on close:** All 8 containers `running`. Docs complete (22 files).
Test suite: **99/99 OK** (last full run this session). Live health: `ok`.
**No code was changed in the final docs pass** — work tree is exactly as
last verified, plus `docs/`.

---

## 1. Where the project stands

PRAMAAN (AI-powered criminal network analysis) is built end-to-end across
Phases 1–8 **before today**: Django + DRF backend (13 apps), Next.js 14
frontend (7 routes, 22 components), Neo4j 5.21 temporal graph (GDS 2.9.0 +
APOC), spaCy/regex extraction pipeline on Celery, MinIO evidence store,
pgvector + trigram Postgres, Gemini RAG copilot (key-optional), realtime
WS alerts, MapLibre geo, PDF evidence packages, TOTP 2FA, EN/हिं toggle,
light/dark themes, PWA manifest + offline upload outbox.

**What was done TODAY (this session): documentation only.**
Read the entire codebase (all apps, routes, services, tasks, migrations,
seed, compose, Dockerfiles, nginx, frontend routes/components/lib) and
produced:
- `docs/` structured set — README index, 6 architecture files, 2 setup
  files, 7 feature files, API endpoints, 2 data-model files, testing,
  decisions (21 files).
- `docs/MASTER_DOCUMENTATION.md` — 14-section single-document walkthrough
  (demos/judges/onboarding).
- Everything flagged ⚠️ Stub where not fully wired (see §4 below).
- Verified: all 22 internal cross-links resolve; full suite re-run
  **99 tests OK**; live `/api/health/` → `ok`.

Entry points: app `http://localhost:8080` · API `/api/` (+ `/api/docs/`)
· Neo4j `:7474` · MinIO `:9001`. Demo logins (password `Pramaan123!`):
`sho_demo`, `inv_demo`, `inv_priya`, `inv_amit`.

---

## 2. Environment specifics (don't reconstruct these)

- Host remaps (local Postgres/Redis squat the defaults): PG `:5433`,
  Redis `:6380`. Containers use `db:5432`/`redis:6379`.
- Host dev env: `DATABASE_URL=postgres://pramaan:pramaan@localhost:5433/pramaan`,
  `REDIS_URL=redis://localhost:6380/0`, `NEO4J_URI=bolt://localhost:7687`,
  `NEO4J_PASSWORD=pramaan-neo4j`, `CELERY_EAGER=1` (skip worker).
- Measured live versions: Neo4j 5.21 + GDS 2.9.0 + APOC 5.21.2; pgvector
  0.8.6, pg_trgm 1.6, PostGIS 3.4.3. API latencies (warmed): login ~240 ms,
  me 22 ms, cases 67 ms, search 86 ms.
- Seed (`seed_demo --cases 6`) is idempotent; demo users reset to 2FA-free.
- ws/alerts works through nginx (`/ws/` route); backend serves via
  **daphne** (runserver = HTTP only). After editing `nginx.conf`:
  `docker exec pramaan-nginx-1 nginx -s reload`.
- After adding an npm dep: `docker compose rm -sf frontend && docker compose up -d frontend`
  (source-only mounts are safe, but recreate guarantees freshness).
- No Gemini key configured → keyword-only RAG + extractive copilot (by design).
- `requirements-ml.txt` (paddle/torch/transformers/sklearn) is **not installed**.

---

## 3. Still remaining (honest stub/partial list)

1. What-if simulation — service returns `"not-computed"`, unrouted.
2. `Event` nodes / `MET_AT` edges / `valid_to` — schema without producers.
3. IndicBERT NER + IndicXlit transliteration — hooks only (`transliterate()`
   raises ImportError; no `extract_hf()`).
4. PaddleOCR inactive without ML stack (scanned images → `unavailable`).
5. **Field-level AES unwired** (`apps/security.py` never imported) — top security gap.
6. Real SMTP digests (mocked); service worker (manifest only); automated token refresh.
7. UI missing for: case create/assign/close, comment delete, geo-nearby, manual locate.
8. Case `close()` has no archival flow; Swagger version string stale ("Phase 1");
   `requirements.txt` comment still says `google-generativeai` (dep is `google-genai`).
9. `SENTRY_DSN` read by nothing; full a11y audit not done.

---

## 4. Known bugs / blockers / TODOs

- **BUG (live):** `GraphViewSet` defines `timeline` twice
  (`backend/apps/graph_api/views.py:65` vs `:108`); the unguarded second copy
  wins → Neo4j-down 500s on `/timeline/` instead of graceful fallback.
- `AuditLog.object_id` always `""`, `before` always `{}` (only response status kept).
- `Case.risk_level` free text, never synced from GDS risk scores.
- Duplicate `timeline` action + dead `snapshot`/`diff`/`what_if` view actions
  (no routes) + dead `apps/admin_register.py` (414 B, never imported) await deletion.
- Assumptions made in docs (see `MASTER_DOCUMENTATION.md` §14): table names
  follow Django convention; `AlertRuleViewSet` scoping inferred from tests;
  lessons-learned reconstructed from comments/build history; perf numbers are
  demo-data, not load tests.
- No blockers. No uncommitted-code risk (repo is not git-initialized).

---

## 5. Exact files/modules to work on next (in recommended order)

**Tomorrow's order — security + correctness first, features second:**

1. `backend/apps/security.py` + `Evidence`/`ExtractedEntity` PII fields + new
   migration — wire Fernet AES (or replace with a maintained encrypted-field
   package); add `FIELD_ENCRYPTION_KEY` to `.env` (generate, never commit).
2. `backend/apps/graph_api/views.py:108-112` — delete the duplicate
   `timeline` (keep the guarded one); delete dead `snapshot`/`diff`/`what_if`
   actions; delete `backend/apps/admin_register.py`.
3. `backend/apps/cases/views.py::close` — decide: implement archival flow or
   fix the docstring; wire `Case.risk_level` sync from risk scores (or drop
   the field comment claiming Phase 5 computes it).
4. `frontend/lib/api.ts` — add `createCase/assignCase/closeCase` helpers;
   `frontend/app/cases/page.tsx` — SHO create + assign UI (biggest demo-visible gap).
5. `frontend/components/workflow.tsx` — comment-delete button;
   `frontend/components/geo-map.tsx` — nearby form + locate form
   (endpoints `geo/nearby/`, `entities/…/locate/` already exist + tested).
6. `frontend/lib/api.ts` — silent token refresh on 401 (currently login-again).
7. `backend/requirements-ml.txt` install path — scanned-OCR + Indic NER spike
   (needs ~500 MB+ deps; document decision).
8. `frontend/public/` — service worker for true offline caching (manifest exists).
9. Load test toward ~100 concurrent users; `next start` production frontend;
   backup/retention jobs; real SMTP for digests.
10. Docs touch-ups only if code changes: `docs/api/endpoints.md`,
    `docs/data-model/postgres-schema.md`, relevant feature file.

**Verification loop after any change:** `python manage.py test` (Postgres +
`CELERY_EAGER=1`, ~80 s) → `npx tsc --noEmit` + `npm run build` →
`docker compose build <svc>` + `up -d` → spot-check via `/api/health/` and
the touched UI route. Full command reference: `docs/setup/local-dev.md`.

---

*Handoff written 2026-09-10. Stack left running; work tree clean (docs only).*
