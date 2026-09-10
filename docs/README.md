# PRAMAAN Documentation

AI-powered criminal network analysis: fragmented investigation data in,
evidence-backed temporal knowledge graph out. Every AI claim traces to
source evidence with a confidence score.

> Ground rule for these docs: everything here was written from the actual
> source files. Anything not fully wired is flagged ⚠️ **Stub** — no
> aspirational features are described as built.

## Index

**Architecture** — how the system fits together
- [System overview](architecture/overview.md) — diagram + end-to-end data flow
- [Backend](architecture/backend.md) — Django apps, models, endpoints, tasks
- [Frontend](architecture/frontend.md) — routes, components, state, API client
- [Graph layer](architecture/graph-layer.md) — Neo4j schema + `graph_service.py` contract
- [AI pipeline](architecture/ai-pipeline.md) — every stage: input → tool → output → storage
- [Infrastructure](architecture/infra.md) — containers, Nginx, networking, volumes

**Setup**
- [Local development](setup/local-dev.md) — from zero to running demo
- [Environment variables](setup/environment-variables.md) — every variable, what it does

**Features** — what each role can do, and where the code lives
- [SHO dashboard](features/sho-dashboard.md) · [Investigator dashboard](features/investigator-dashboard.md)
- [Graph explorer](features/graph-explorer.md) · [Analytics & risk scoring](features/analytics-and-risk-scoring.md)
- [Security & 2FA](features/security-and-2fa.md) · [i18n & accessibility](features/i18n-and-accessibility.md)
- [Offline & PWA](features/offline-and-pwa.md)

**Reference**
- [API endpoints](api/endpoints.md) — every real route, generated from the DRF code
- [Postgres schema](data-model/postgres-schema.md) — every model, from `models.py`/migrations
- [Neo4j schema](data-model/neo4j-schema.md) — node/edge types actually written by the pipeline
- [Test coverage](testing/test-coverage.md) — suites, what they check, how to run
- [Tech choices](decisions/tech-choices.md) — why each major decision was made

**Start here if you have zero context:** [MASTER_DOCUMENTATION.md](MASTER_DOCUMENTATION.md) —
one long document that explains the whole system start to finish (demos, judges, onboarding).

## 30-second orientation

```
Investigator uploads file → Django hashes + stores in MinIO → Celery pipeline
(classify → OCR → NER → relations → resolve → index) → investigator confirms
AI suggestions in a review queue → confirmed rows are MERGEd into Neo4j with
source_evidence_id + confidence + dates → Cytoscape explorer, GDS analytics,
RAG copilot, PDF evidence packages.
```

- App entry: `http://localhost:8080` (Nginx) · API: `/api/` · Neo4j browser: `:7474` · MinIO console: `:9001`
- Demo logins (see [local-dev](setup/local-dev.md)): `sho_demo` / `inv_demo` / `inv_priya` / `inv_amit`, password `Pramaan123!`
- Test suite: 99 tests, 9 files — see [test-coverage](testing/test-coverage.md)
