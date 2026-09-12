# PRAMAAN — Codebase Analysis

Date: 2026-09-12. Method: full read-through of `backend/`, `frontend/`, and `docs/`
(supplemented by running the test suite: **134/134 backend tests pass**).
Status markers: ✅ Working · ⚠️ Partial · ❌ Missing · 🗑️ Dead code · 🎭 Misleading
(UI implies more than the code delivers — the most important flag in this document).

> Scope note: this pass covers the Django backend, the Next.js 14 frontend in the
> `(auth)`/`(app)` route groups, Celery tasks, and the Neo4j read/write schema.
> Line references were accurate at time of writing.

---

## PART 1 — FEATURE-BY-FEATURE REALITY CHECK

### 1. Case Management — ✅ Working end-to-end
Backend (`backend/apps/cases/views.py`) implements list (scoped, paginated, `?q=&status=&ordering=`),
SHO-only create/delete/close, plus `POST …/close/`, `…/reopen/`, `…/assign/` (with
`permission:"remove"` unassign), all RBAC-gated and audited. ICJS import
(`backend/apps/icjs/views.py:64-187`) creates the case and feeds every bundle file
through the same `create_evidence()` pipeline. Frontend covers it all: dashboard and
`/cases` modals (`frontend/components/case/CaseModals.tsx`), team matrix + case Team
tab (`assignCase`/`unassignCase`), header Close/Reopen/Delete with confirm modal.
Verified by screenshot (SHO sees Close/Delete/Team tab; investigators don't).

### 2. Evidence Upload — ✅ Working end-to-end
Single ingestion path `create_evidence()` (`backend/apps/evidence/services/ingest.py:13-51`):
SHA-256 → MinIO → row → custody log → Celery chain. Multipart upload, offline-tolerant
(failures recorded on `processing_error`, never raised). SHO upload correctly rejected
with 403 by design (`user_can_contribute_case()` excludes SHO;
`backend/apps/cases/permissions.py:26-36`), and the UI states this verbatim in the
Evidence tab. Polling refresh, custody/download/reprocess endpoints all live.
Gap: no delete/custody/download buttons in the new Evidence UI (endpoints exist,
`frontend/lib/endpoints.ts:120-134`); no offline outbox (see §3).

### 3. OCR / Extraction — ⚠️ Partial (real core, honest gaps, hardcoded confidences)
- **Real:** `pypdf` text extraction and raw-text (txt/csv) paths
  (`backend/apps/evidence/services/ocr.py:56-80`); PaddleOCR lazily invoked for images
  (`ocr.py:96-115`); spaCy `en_core_web_sm` NER with regex anchors for phones/plates
  (`backend/apps/graph_api/services/extract.py:27-43,95-109`); sentence co-occurrence
  relation extraction emitting CALLED / TRANSFERRED_MONEY_TO / ASSOCIATED_WITH / OWNS /
  EMPLOYED_BY / PRESENT_AT (`extract.py:269-348`).
- **Hardcoded, not computed:** every classifier confidence (`classifier.py:19-66`,
  e.g. `0.80` FIR, `0.30` fallback), every NER confidence (`0.95` phone, `0.75`
  multi-token person, `extract.py:149-197`), every relation confidence (`0.45–0.60`,
  `extract.py:317-347`). Users see these as "75%" bars; they are rule constants, not
  model scores. Only merge-suggestion scores are genuinely computed (difflib +
  token overlap, `resolve.py:41-87`).
- **Missing/stubbed:** scanned-PDF rasterization returns honest `unavailable`
  (`ocr.py:81-83`); xls/xlsx/doc/docx/audio (mp3/wav) get a classification label but
  OCR is `skipped` — **no transcription, no spreadsheet parsing**; `extract_hf()`
  referenced but unimplemented (`extract.py:11-12`); transliteration raises
  `ImportError` by design (`resolve.py:28-34`); English-only throughout (no detection,
  translation, IndicBERT — see Part 4A).

### 4. Entity Resolution — ⚠️ Partial (real matcher, human-gated correctly)
`resolve.py` blocking + scored matching with thresholds (`SUGGEST 0.75`, `AUTO_MERGE
0.99` reserved), persisted as `MergeSuggestion(score, reason)`. Investigator confirm /
reject and SHO-only approve are enforced server-side (`views_review.py:194-294`) and
in the UI (Entities tab merge section; nested `POST …/entities/{eid}/confirm|reject`
reject SHO with 403 — covered by `backend/apps/analytics/tests_dashboard.py`). Neo4j
`merge_nodes` via APOC is best-effort. `Event` entities are never suggested
(`resolve.py:113-114`).

### 5. Graph Construction — ✅ Working (narrow scope), stubs beside it
Only `CONFIRMED` rows are built into Neo4j, every node/edge carrying
`confidence_score`, `source_evidence_id`, snippet, `extracted_by`,
`valid_from` (`backend/apps/graph_api/tasks.py:215-263`). Reads (graph, expand
depth ≤3, shortest path ≤5 hops, timeline) are live with honest `live:false`
degradation. The new Canvas 2D frontend renders real nodes/edges/clusters with
server-computed cluster assignment (`views.py:_clusters_for:151-224`). Every
confirm auto-rebuilds. 🗑️ Beside it: `snapshot/diff/what_if` ViewSet actions are
canned stubs (`graph_service.py:226-233`), and there are **two** `timeline()`
definitions in `views.py:67-75,128-132` (second wins; first is dead).

### 6. Pattern / Anomaly Detection — ⚠️ Partial (real statistics, no pattern objects)
`anomalies.py:33-111` computes genuine hub-outlier (z-score), contact-burst, and
weak-evidence-community statistics with derived confidences — but there is **no
`SuspiciousPattern` model**: no structuring/round-trip/mule/burner-phone/co-location/
call-spike rules, no pattern type/status/assignee object. Anomalies fan out to alerts
only through the generic rule-gated emitter (`tasks.py:_post_build_alerts:60-96`).

### 7. Explainable AI — ⚠️ Partial
Risk scoring is real math with persisted factor breakdowns (`risk.py:17-70`,
weights sum to 1, `RiskReport` model, history endpoint). Copilot is regex-routed
(`intents.py`): path/summary answers are **templated, `generated:False`**; only the
generic branch can call Gemini (`gemini-2.0-flash`, evidence-grounded prompt,
`copilot/views.py:193-198`), degrading honestly to extractive keyword answers without
a key. No role inference (financier/broker/kingpin — zero hits); "Top players" is a
pagerank-sorted list with no dedicated dashboard card in the new UI.

### 8. Cross-Case Linking — ✅ Working end-to-end
`shared_entities` scoped by `visible_case_ids` (strict no-leak tests), surfaced in the
Cross-Case Links tab (linked-cases table + shared-signal table) and the dashboard
review queue. Fan-out emits medium alerts.

### 9. RBAC — ✅ Working, with one hole
Three roles, `IsSHO`, view/edit/contribute triple-gate, `visible_case_ids()` applied
at queryset level on cases/evidence/review/analytics/search/copilot/alerts/reports,
wrong-door 403 with structured `{error:"wrong_door"}` body, per-(IP,user) login
throttling, 2FA verify path. Proven by 134 passing tests including scoping tests.
⚠️ **Hole (verified): `district_list`/`district_overview`
(`backend/apps/analytics/views.py:~155-202`) filter by district with no visibility
check** — any authenticated user can enumerate case counts, per-user workload, and
top shared entities for districts containing cases they cannot see.

### 10. Audit Logging — ⚠️ Partial (strong custody, thin audit)
Two systems: (a) per-evidence **chain-of-custody ledger** — thorough (actor, action,
details, snapshot, survives delete via `SET_NULL`); (b) global `AuditLog` via
middleware — thin: **`object_id` is always `""`, `before` is never set,
`after` is only `{status: code}`** (`backend/apps/auditlog/middleware.py:20-21`).
Every mutation writes a row (verified in the Audit Log tab UI), but rows say
`update /api/cases/1/...` with no entity id or state diff. No hash-chaining, no
retention/pruning, model is mutable. Inconsistency: investigators see only own rows
at `/api/audit/` but the case activity feed returns all actors' rows.

### 11. Notifications — ✅ Working end-to-end
`emit_event` with 24h dedupe → rule matching + visibility check → in-app
Notification + live WebSocket push (`alerts/consumers.py`, JWT `?token=` auth).
Rule-gated delivery, strict cross-case no-leak, and socket delivery are all tested.
ICJS progress frames reuse the socket transiently (not persisted — by design).

---

## PART 2 — AI/ML LOGIC AUDIT

| Component | What's actually called | Real / mock / stub | Output destination | Confidence shown |
|---|---|---|---|---|
| File classification | Filename/content heuristics, `classifier.py` | Real (no ML; docstring admits it) | `Evidence.classification(+_confidence)` → Evidence tab | 🎭 Hardcoded literals (`0.30`–`0.90`) |
| OCR (digital PDF/txt/csv) | `pypdf`, raw read | Real | `Evidence.ocr_text/pages/engine/status` → pipeline only (text **excluded** from evidence serializer; surfaces via search snippets + RAG chunks) | Hardcoded (`1.0`/`0.95`); not even persisted |
| OCR (images) | `PaddleOCR(lang="en")`, lazy | Real when installed; honest `unavailable` otherwise | Same as above | Hardcoded `0.80` |
| OCR (scanned PDF/xls/docx/audio) | Nothing | ❌ Skipped (`skipped` status); audio untranscribed | Nowhere | `0.0` |
| NER | spaCy `en_core_web_sm` + regex anchors | Real; `extract_hf()` stub | `ExtractedEntity` PENDING → review queue → Neo4j on confirm | 🎭 Hardcoded per-type constants |
| Relation extraction | Sentence co-occurrence + verb lists | Real, narrow (6 rel types) | `ExtractedRelation` PENDING → queue → graph | 🎭 Hardcoded `0.45`–`0.60` |
| Entity resolution | difflib + token overlap | **Genuinely computed** — the only computed score in the pipe | `MergeSuggestion(score, reason)` → Entities tab | Computed (thresholds 0.75/0.99) |
| GDS analytics | Neo4j GDS degree/PageRank/betweenness/WCC/Louvain | Real, honest per-algo degradation with notes | Overview endpoint → Network tab communities; risk/anomaly inputs | Real statistics |
| Risk | Weighted sum, 5 factors | Real + persisted `RiskReport` | Risk endpoint/history, alerts | Computed |
| Anomalies | z-score/burst/density rules | Real statistics | Ephemeral response + alert fan-out; **no stored object** | Derived formulas |
| Copilot path/summary | Postgres + Neo4j shortestPath + GDS templates | Real but **templated (`generated:False`)** | Chat UI with citations | n/a (no scores shown) |
| Copilot generic | Gemini `gemini-2.0-flash` + `text-embedding-004` | Real iff `GEMINI_API_KEY` set; else honest extractive fallback | Chat UI, citations truncated to 4 × 90 chars | Retrieval scores dropped in UI |
| Embeddings | Gemini 768-d, batched | Real iff key; else `None` vectors, keyword retrieval | `DocumentChunk` | n/a |
| Transliteration/IndicBERT/translation | `indicxlit` import then `raise ImportError`; none else | ❌ Stub/absent | Nowhere | n/a |
| Seed data NER | **Real** `extract_entities/relations` run over 3 hand-written statements | Real inference on synthetic text | Confirmed graph (demo dataset) | Same hardcoded constants |

The pitch-critical correction: **no neural model produces any entity, relation, or
classification in this pipeline.** The "AI" that is real: statistical graph analytics,
a scored dedupe matcher, and an optional Gemini RAG branch. Everything the user sees
as a percentage (except merge scores) is a rule constant.

---

## PART 3 — DEAD CODE AND UNUSED FILES

### 🗑️ Delete (verified zero references, safe to remove)
- `backend/config/urls.py:12+20` — duplicate `include("apps.icjs.urls")` (second
  registration redundant; comment justifies only the first).
- `backend/apps/graph_api/views.py:67-75` — shadowed first `timeline()` (second at
  `:128-132` wins; first also has better 503 handling, so delete the *second* and
  keep the first — or merge; currently Neo4j-down 500s).
- `backend/apps/graph_api/services/graph_service.py:226-233` — `snapshot/diff/what_if`
  canned stubs (real snapshot logic lives in `views_snapshots.py`, which is itself
  UI-less — see below).
- `backend/apps/admin_register.py` — never imported; per-app `admin.py` does the work.
- `frontend/lib/api.ts:155-481` — legacy `api.*` object (~70 methods); only
  `api.login/login2fa` still used (login page). Canonical client is `lib/endpoints.ts`.
- `frontend/lib/endpoints.ts:loginUser` — dead wrapper that voids its own args.
- `frontend/lib/format.ts:phone/inr/humanize`, `lib/auth.ts:isInvestigator/canUpload/
  canVerify/userZone` — zero importers.
- `frontend` legacy component names referenced by old docs (`ReviewQueue`,
  `EvidenceManager`, `AnalyticsPanel`, `GeoMap`, `WorkflowPanel`, `HeaderNav`,
  `LangToggle`, `AlertsBell`, `outbox`, `i18n`, `replay`, `DistrictPanel`) — already
  deleted from code; only docs still mention them (see docs note).

### Scaffolding — live backend, no UI (KEEP code, the gap is UI)
`analytics/districts|district|compare`, `cases/{id}/relationships|graph/expand|
graph/build|graph/snapshots*|geo/*|entities/*/locate`, review `decide*` alternates,
`reports/*`, alert rules/digests, 2FA setup/QR/disable UI, evidence delete/custody/
download buttons, snapshot/compare panels, district dashboard. All tested; all
invisible. (Geo/replay/snapshot panels existed in the *previous* frontend iteration
and were cut in the rebuild — a conscious scope decision, now a coverage gap.)

### Data-level dead weight (keep, but know)
- Neo4j accepts `Event` nodes, `MET_AT`/`RELATED_TO` edges, `valid_to` — **zero
  producers**; schema-ready but permanently empty (Part 4B).
- `Case.state` (ICJS-written, never read), `risk_level` free-text (never synced from
  GDS risk), `merged_into/graph_key` (backend-live, zero frontend reads).
- `FIELD_ENCRYPTION_KEY` + `apps/security.py` encrypt/decrypt — defined, zero callers.

### Misleading-but-live UI (🎭 — small fixes, listed for the sprint)
1. **Overview "N pending review" is always 0 or 1** — `OverviewTab.tsx:41`
   calls `reviewEntities(cid,"pending",1)` then renders `.length` as the total.
   One-line fix: use the queue count.
2. **Network "Zoom N%" tracks buttons only** (`NetworkGraph.tsx:23-28`, comment
   admits canvas owns exact scale); wheel/fit desync it. Read scale from the canvas.
3. **"1 occurrence"** on every rel-card and **"Cases: 1"** in Entities
   (`EntityDetailPanel.tsx:57`, `EntitiesTab.tsx:185`) are literals, not counts.
4. **Audit Log tab filters the global feed by regex on `object_type`** —
   works today (verified rows render) but breaks silently if path shapes change;
   the case-scoped `activity_feed` endpoint exists and is unused.
5. Investigator "Use 2FA" login checkbox only toggles input visibility; nothing
   enforces it. My Cases "Read" tag can only appear for view-permission assignments,
   which no UI flow creates (all assigns are `edit`).

---

## PART 4 — GAP ANALYSIS (prior-review list, re-verified)

**A. OCR + multilingual — ⚠️ Partial.** PaddleOCR is genuinely invoked (lazy import,
`ocr.py:96-115`); Tesseract absent; IndicBERT/IndicXlit/translation/detection are
stubs or absent (`resolve.py:28-34`, requirements comments only). Pipeline is
effectively English-only; Hindi FIRs OCR (if images) then hit English regex/spaCy.
**B. Event / MET_AT / valid_to — ❌ Missing.** Schema accepts all three; producers:
none. No meeting/seizure/raid/arrest/sighting producers, no CDR co-location join, no
`valid_to` set anywhere (`extract.py:295-296` emits `valid_from` only). Timeline tab
is genuine but dat*ed-edge*-driven, not event-driven.
**C. First-class entities — ⚠️ Partial.** Person/PhoneNumber/Vehicle/Location/
Organization are real typed nodes with real CALLED/OWNS/PRESENT_AT/ASSOCIATED_WITH
edges. Financial accounts, transactions, amounts, social handles/groups are **not**
nodes (money regex gates transfers only; org-like tokens suppressed as noise).
**D. Suspicious-pattern engine — ❌ Missing** as an object. Real anomaly statistics +
alert fan-out exist, but no `SuspiciousPattern` model, no structuring/round-trip/
mule/burner/co-location/spike rules, no assignee workflow.
**E. Key-player roles — ❌ Missing.** No role inference; `key_players` is a pagerank
sort; no Top-players card in the new dashboard.
**F. Connectors — ⚠️ Partial.** Upload + full ICJS bundle import both flow through
`create_evidence()` + review queue (verified). No CSV/Excel/JSON/CCTNS importers;
no bulk-evidence importer.
**G. UI for backend gaps — mixed.** ✅ SHO create/assign/close/reopen/delete,
comment delete, ICJS import, report export all have working UI+API.
❌ No UI: geo nearby/movements/locate, snapshots/compare, district views,
analytics workbench, alert rules, 2FA setup, report history, evidence delete/
custody/download buttons.
**H. Security/legal — ❌ Mostly missing.** Encryption defined-never-wired (plaintext
`totp_secret`, phones, OCR text); audit rows lack entity ids and diffs; no hash
chain; no retention/legal-hold/redaction; hard deletes cascade (custody rows survive
via `SET_NULL` — the one bright spot).

## PART 5 — PRIORITIZED NEXT STEPS

### Tier 1 — highest leverage (judge-noticeable, investigator-useful)
1. **Real CDR co-location → first genuine `MET_AT` edges + `valid_from/valid_to`.**
   Parse tower/timestamp columns from CDR CSVs into dated PRESENCE facts, join
   same-tower-overlapping-time person pairs. Files: new
   `backend/apps/evidence/services/cdr.py`, extend `extract.py` + `tasks.py:
   extract_relations`, graph build passes `valid_to`. Size: medium.
2. **`SuspiciousPattern` model + 3 rules feeding existing alerts.** Model
   (type, entities, snippets, confidence, status, assignee) + structuring,
   round-trip, burner-swap detectors over Postgres data, emitting through the
   proven `emit_event`/rule/WS path. Files: new `apps/patterns/` (model, rules,
   tests), hook into `tasks.py:_post_build_alerts`. Size: medium-large.
3. **Fix the five 🎭 UI misrepresentations** (pending-count cap, zoom %,
   "1 occurrence"/"Cases: 1", audit regex → `activity_feed`, 2FA checkbox).
   Files: `OverviewTab.tsx:41`, `NetworkGraph.tsx:23-28`, `EntityDetailPanel`,
   `AuditTab.tsx:35-39`, login page. Size: small (one afternoon, high honesty
   value).
4. **Close the RBAC district hole + audit `object_id`/diffs.** Scope
   `district_*` by `visible_case_ids`; populate `object_id` + before/after in
   middleware for case/entity/review mutations. Files: `analytics/views.py:
   ~155-202`, `auditlog/middleware.py`. Size: small-medium.
5. **Wire encryption for `totp_secret` + phone/PII columns** using the existing
   `apps/security.py` Fernet helpers (key already in settings). Size: small.

### Tier 2 — after Tier 1
- **Bulk CSV/Excel importer** (CDR, bank statements) through `create_evidence()`
  + review queue (`pandas/openpyxl`, new `apps/evidence/services/tabular.py`).
  Medium. (JSON/social and CCTNS remain out of scope without a real feed.)
- **Vehicle/financial first-class nodes**: plates already nodes; add Account nodes
  + `HAS_ACCOUNT`/`TRANSFERRED_MONEY_TO` with amounts from `MONEY_RE` context.
  Medium. Social handles: skip until a real source exists.
- **Key-player roles + Top-players card**: role rules over pagerank/betweenness/
  financial-degree/recency → role tag + evidence list; dashboard card. Small-medium.
- **Audit hash-chaining + retention job** (`prev_hash` field, nightly prune with
  legal-hold flag). Medium. Full redaction levels: large, defer.
- **Evaluation harness**: synthetic FIR/CDR ground truth + precision/recall for
  NER/relations/link-prediction/risk ranking (`backend/apps/eval/`). Medium;
  makes accuracy claims defensible.

---

## HONEST SUMMARY

If a judge opens this codebase today and clicks through everything, the experience
is genuinely coherent: role-gated login with three doors, a dense dark console,
real cases with real evidence files, an investigator review queue whose
confirm/reject clicks really write to Neo4j, a Canvas graph with real clusters and
a working inspector, timelines, cross-case links, notes, tasks, and an audit trail.
Nothing on the happy path is faked — uploads process, merges need SHO approval, and
the wrong door really rejects. What the pitch must *not* claim: there is no neural
AI extracting anything (rules + spaCy + heuristics, with hardcoded confidences
except dedupe scores); there are no event nodes, no MET_AT edges, no financial or
social graph citizens, no pattern-rule engine, no multilingual path, no encryption,
and several live backend capabilities (geo, snapshots, analytics workbench, 2FA
setup) have no buttons anywhere. The five 🎭 UI nits and the district scoping hole
are the cheapest fixes with the highest integrity payoff; CDR co-location and a
real `SuspiciousPattern` engine are the two features that would most change what a
judge concludes about depth. This is a strong, honest investigation-workflow
prototype with a real RBAC/audit spine — one sprint away from being demo-bulletproof,
two from being analytically deep.
