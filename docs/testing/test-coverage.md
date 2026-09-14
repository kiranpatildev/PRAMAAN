# Test Coverage

255 tests (run: `python manage.py test`). Suite needs **Postgres**
(vector/trigram paths); point `DATABASE_URL` at `:5433` and set
`CELERY_EAGER=1`. Last full run: **255/255 OK** (2026-09-14, incl. 40
multilingual + 60 graph-query tests). No frontend test runner is configured
(verification is `tsc --noEmit` + `next build` + live checks).

| File | Tests | What it actually checks |
|---|---|---|
| `accounts/tests_2fa.py` | 3 | TOTP vectors (incl. ±1-step skew, malformed input), full setup→verify→gate→code-login→disable flow |
| `alerts/tests.py` | 7 | Rule matching matrix, 24 h dedupe, strict cross-case delivery (outsider gets nothing), relation-confirm hook, feed scoping, personal rules CRUD, unread/mark-read, WS connect+receive (in-memory layer) and anonymous reject |
| `analytics/tests.py` | 16 | Weights sum to 1, hub-outranks-leaf math + factor-sum identity, empty-graph zeros, hub/burst/weak-community rules, quiet graph empty, GDS mapping + bridge derivation + algo-failure notes + projection drop (mocked driver), overview/risk/anomaly endpoints, auto-persisted RiskReport, cross-case scoping, forbidden case, compare math + missing-param 400; district geo aggregates (scoped coords+counts, unplaceable counted, outsider isolation) |
| `cases/tests_phase7.py` | 10 | PDF starts `%PDF` + row hash/size, download 200, outsider 403, district aggregates, tasks (assignee-must-see-case, advance, delete), comments (author/SHO delete), links (self-link 400, invisible-target 403, dup 409, either-side list), activity contains audit+task+comment, map exhibit packaged (PNG→evidence→PDF §5 embed, custody row), exhibit validation (bad type 400, oversize 400, no evidence leak) |
| `copilot/tests.py` | 17 | Chunking (empty/short/overlap), intent regexes (3 path forms, summaries, generic fallback), indexing with mocked Gemini (768-d vectors) and without key (null embeddings, idempotent reindex), path QA without LLM, unknown-entity answer, extractive generic, generated-with-key, scoping (outsider 403 + sees nothing), grouped search, trigram typo, search scoping/filters |
| `evidence/tests.py` | 14 | Classifier (FIR/CDR/bank/photo/fallback, content-beats-filename), OCR (raw text, pypdf layer, classifier feed, paddle-absent→unavailable, audio skipped), hand-built minimal PDF fixture, full upload→classify→OCR→custody flow (mocked MinIO), custody/download/reprocess endpoints, storage-outage degradation, outsider 403s |
| `graph_api/tests.py` | 19 | Normalization (phones/plates/titles), regex extraction + provenance on every edge, name-fallback + alias OWNS, money direction, resolution scoring (exact/initial/different-surname/type anchors), blocking, idempotent extraction, confirmed-only builds + contract fields, Cypher shape + node-key format, unreachable-Neo4j error, review confirm→rebuild, SHO-only merge + repoint + 409, scoped search/detail |
| `graph_api/tests_explorer.py` | 11 | Date parsing (3 formats, invalid dropped), sentence-date on relations, filter params reach Cypher, unknown-type 400, expand clamp/center, timeline mapping, snapshot save/list/diff/delete, outsider blocked, filter/expand/timeline endpoint wiring |
| `graph_api/tests_geo.py` | 24 | Haversine sanity (~120 km Pune–Mumbai), gazetteer exact/prefix/miss (+hyphenated towers), hotspot grouping, gazetteer auto-pin, CDR tower-column parsing (header variants, bad dates, no-tower-column); map endpoint: suspects (latest dated presence wins, rejected excluded) + CDR-sourced device pings + tower pins (grouped, dated, non-CDR excluded) + unlocated, outsider 403, empty case; movements trail oldest-first (undated/rejected/unlocated excluded, ordering, guards); nearby hits sorted/windowed (undated passes, rejected entities excluded, non-Person excluded, guards); locate correction (happy path sets manual, permissions incl. SHO, validation matrix, cross-case 404) |
| `copilot/tests_graph_query.py` | 60 | Slice 1: restricted-Cypher grammar (accept shapes + 20-case reject battery with reasons), scope-injection text/params/LIMIT clamp, schema-text tracks constants, record shaping + timeout, endpoint scoping/audit/throttle/no-LLM, GraphUnavailable degradation. Slice 2: prompt contract (live schema, strict JSON, confidence clamp), generation view (executes behind gate, hostile-model-output never executes, model-unanswerable/garbage/no-key paths, scope-wins param merge, single temp-0 call). Slice 3: temporal resolution (weekday edges, weeks/months/years, span merge), mention handling (quoted ambiguity, pending exclusion, Devanagari, ask-before-LLM, server-dates-win, hint-in-prompt), bare alias re-mention. Slice 4: eval gold-validity (all 30 gate-accept, sets small, values unique). Acceptance: `eval_graph_queries` (30/30 keyless on live Neo4j) |
| `graph_api/tests_multilingual.py` | 40 | langdetect routing (hi/mr/en verified, short-text floor, romanized-Hindi stays English), English-path parity, pure-python softmax + BIO decode (incl. MISC skip, alias folding), mocked-model contract + native snippets, loader-failure → `unsupported_language` with zero rows (never touches spaCy), Xlit resolve fallback (capped, ASCII-identical), DB pipeline (language persisted, queue shape carries `native_snippet`/`detected_language`, English unchanged, Tamil-no-model writes nothing), run_ocr persists detection |

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
