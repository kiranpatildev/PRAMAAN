# Test Coverage

99 tests across 9 files (counted from `def test` — run: `python manage.py
test`). Suite needs **Postgres** (vector/trigram paths); point
`DATABASE_URL` at `:5433` and set `CELERY_EAGER=1`. Last full run: **99/99
OK**. No frontend test runner is configured (verification is `tsc
--noEmit` + `next build` + live checks).

| File | Tests | What it actually checks |
|---|---|---|
| `accounts/tests_2fa.py` | 3 | TOTP vectors (incl. ±1-step skew, malformed input), full setup→verify→gate→code-login→disable flow |
| `alerts/tests.py` | 7 | Rule matching matrix, 24 h dedupe, strict cross-case delivery (outsider gets nothing), relation-confirm hook, feed scoping, personal rules CRUD, unread/mark-read, WS connect+receive (in-memory layer) and anonymous reject |
| `analytics/tests.py` | 13 | Weights sum to 1, hub-outranks-leaf math + factor-sum identity, empty-graph zeros, hub/burst/weak-community rules, quiet graph empty, GDS mapping + bridge derivation + algo-failure notes + projection drop (mocked driver), overview/risk/anomaly endpoints, auto-persisted RiskReport, cross-case scoping, forbidden case, compare math + missing-param 400 |
| `cases/tests_phase7.py` | 8 | PDF starts `%PDF` + row hash/size, download 200, outsider 403, district aggregates, tasks (assignee-must-see-case, advance, delete), comments (author/SHO delete), links (self-link 400, invisible-target 403, dup 409, either-side list), activity contains audit+task+comment |
| `copilot/tests.py` | 17 | Chunking (empty/short/overlap), intent regexes (3 path forms, summaries, generic fallback), indexing with mocked Gemini (768-d vectors) and without key (null embeddings, idempotent reindex), path QA without LLM, unknown-entity answer, extractive generic, generated-with-key, scoping (outsider 403 + sees nothing), grouped search, trigram typo, search scoping/filters |
| `evidence/tests.py` | 14 | Classifier (FIR/CDR/bank/photo/fallback, content-beats-filename), OCR (raw text, pypdf layer, classifier feed, paddle-absent→unavailable, audio skipped), hand-built minimal PDF fixture, full upload→classify→OCR→custody flow (mocked MinIO), custody/download/reprocess endpoints, storage-outage degradation, outsider 403s |
| `graph_api/tests.py` | 19 | Normalization (phones/plates/titles), regex extraction + provenance on every edge, name-fallback + alias OWNS, money direction, resolution scoring (exact/initial/different-surname/type anchors), blocking, idempotent extraction, confirmed-only builds + contract fields, Cypher shape + node-key format, unreachable-Neo4j error, review confirm→rebuild, SHO-only merge + repoint + 409, scoped search/detail |
| `graph_api/tests_explorer.py` | 11 | Date parsing (3 formats, invalid dropped), sentence-date on relations, filter params reach Cypher, unknown-type 400, expand clamp/center, timeline mapping, snapshot save/list/diff/delete, outsider blocked, filter/expand/timeline endpoint wiring |
| `graph_api/tests_geo.py` | 7 | Haversine sanity (~120 km Pune–Mumbai), gazetteer exact/prefix/miss, hotspot grouping, points/unlocated, dated movement trail, nearby window+radius+400s, locate perms/validation |

## Conventions worth knowing

- API tests log in through `POST /api/auth/login/` (real JWT), then assert
  status codes **and** DB state; outsider/forbidden paths are asserted
  almost everywhere.
- Heavy deps are mocked at module boundaries (`apps.evidence.services.storage.*`,
  `GraphService`, `google.genai` via a fake module, Neo4j driver sessions).
- spaCy-dependent tests skip cleanly when `en_core_web_sm` is absent
  (regex-only mode still passes).
- Channel tests override to the in-memory layer; the consumer DB lookup
  forces `TransactionTestCase` with unique usernames.
