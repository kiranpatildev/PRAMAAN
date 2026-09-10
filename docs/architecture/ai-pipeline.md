# AI Pipeline — Stage by Stage

One Celery task per stage, each with a typed in/out contract, each
**never raising** (failures land on `Evidence.processing_error`). The
orchestrator `process_evidence` runs them in order: ingest → classify →
OCR → NER → relations → resolve → index. Trigger: upload view
(`process_evidence.delay`) or `reprocess/`; worker: `celery -A config worker`.

```mermaid
flowchart LR
    B[bytes in MinIO] --> C[classify_file<br/>heuristics]
    B --> O[run_ocr<br/>raw-text → pypdf → PaddleOCR?]
    O --> T[(Evidence.ocr_text)]
    T --> E[extract_entities<br/>regex → spaCy → name fallback]
    E --> RQ[(review queue<br/>PENDING entities)]
    T --> R[extract_relations<br/>verb patterns + dates]
    R --> RQ2[(PENDING relations)]
    RQ --> RS[resolve_entities<br/>blocking + scoring]
    RS --> MS[(MergeSuggestions)]
    T --> I[index_evidence<br/>chunk + embed?]
    I --> CH[(DocumentChunks)]
```

## 1. `ingest_evidence` — verify the bytes

Input: evidence id. Re-checks the MinIO object exists (`head_object`).
Output: `{storage_key, sha256, status}`. The actual upload already happened
inline in the view; a missing object just records an error for `/reprocess/`.

## 2. `classify_file` — what kind of document is this?

Pure heuristics in `evidence/services/classifier.py` (`classify(filename,
mime, text_sample)`), first match wins: **content markers** (CDR/bank/FIR/
witness keyword sets, 0.85–0.90) → **filename keywords** (`fir`, `cdr`,
`tower dump`, `witness`, `bank`…, 0.75–0.80) → **extension/MIME**
(image→photo 0.90, audio→transcript 0.85, spreadsheet→cdr 0.55, pdf→document
0.50) → `other` 0.30. The text sample comes from `ocr.sample_text` (never
runs OCR — PDFs via pypdf head, text files directly). Result + confidence
stored on the row; `ChainOfCustody.CLASSIFIED` logged. A learned classifier
can replace `classify()` behind its `{label, confidence, reason}` contract.

## 3. `run_ocr` — bytes to text

`evidence/services/ocr.py`, cheapest engine first (`extract_text` returns
`{text, pages, engine, confidence, status}`):

1. `raw-text` (confidence 1.0): txt/csv/log decoded directly.
2. `pypdf-text` (0.95): PDFs with an embedded text layer (≥50 chars).
3. `paddleocr` (0.80): scanned PDFs/images — **lazy import**; without the
   `requirements-ml.txt` stack it returns `status: "unavailable"` instead of
   failing (⚠️ implemented but **inactive in the base image** — scanned
   uploads index nothing until PaddleOCR is installed).
4. Anything else (audio etc.): `skipped`. Exceptions: `failed` with the
   error recorded — never raised.

## 4. `extract_entities` — NER

`graph_api/services/extract.py`, layered cheap→expensive, regex spans always
win over model spans (overlap suppressed):

- **Regex** (deterministic, Indian-context): `+91`/10-digit phones 0.95,
  Indian plates (`MH12AB1234` shapes) 0.90.
- **spaCy** `en_core_web_sm` (downloaded in the backend Dockerfile; absent →
  regex-only mode with a warning): PERSON 0.75 (multi-token) / 0.55
  (single-token), ORG 0.65, GPE/LOC/FAC 0.65. Small-model noise is
  suppressed by design: phones/amounts it tags DATE are ignored (regex
  owns them), single-token PERSON/ORG matching a known full name folds
  into that person, ALL-CAPS noise tokens (UTR/FIR/CDR/…) are dropped.
- **Name fallback** (`regex-name`, 0.50): two/three capitalized words minus
  a stop-word list — catches Indian names the small English model misses
  in noisy contexts (parentheticals, PRODUCT mistags).
- ⚠️ Stub: the docstring describes a `transformers`/IndicBERT third layer
  (`extract_hf()`), but **no such function exists** — HF/IndicBERT and the
  `transliterate()` IndicXlit placeholder in `resolve.py` (raises
  ImportError) are documented future hooks, not code paths.

Normalization (`normalize_value`) is shared by extraction, resolution, and
Neo4j keys: phones → last 10 digits (91-prefix stripped), plates →
uppercased alnum, names → lowercased, titles (`Shri/Smt/Mr…`) stripped.
Rows upsert idempotently per (case, type, normalized); re-runs bump
`mention_count`.

## 5. `extract_relations` — typed edges with snippets

Sentence-level co-occurrence + verb typing (textual order ⇒ deterministic
direction), each edge carrying the source sentence as its evidence snippet:

| Verbs in sentence | Pair | Edge | Conf |
|---|---|---|---|
| call/spoke/contacted/… | person↔person, person↔phone | `CALLED` | .60/.55 |
| paid/transferred/… + money pattern | parties in order (orgs allowed) | `TRANSFERRED_MONEY_TO` | .60/.55 |
| met/meeting/seen with/… | person↔person | `ASSOCIATED_WITH` | .55 |
| owns/registered/driving/… | person↔phone/vehicle | `OWNS` | .60 |
| works/employed/member/… | person↔org | `EMPLOYED_BY` | .55 |
| (any) | person↔location | `PRESENT_AT` | .50 |
| none, but co-occurring persons | person↔person | `ASSOCIATED_WITH` | .45 (`cooccurrence`) |

Alias-aware mentions: "Rahul owns …" resolves to Rahul Sharma only via an
*unambiguous* first/last-name token, and alias hits inside another
entity's span are discarded ("Sharma" in "Sharma Transports" ≠ Rahul).
`parse_dates` anchors each relation to the sentence's first explicit date
(`valid_from`; "12 March 2026", ISO, DD/MM/YYYY; invalid dates dropped).

## 6. `resolve_entities` — dedupe suggestions, never auto-merge

`resolve.py`: phone-identical → 1.0; plate-identical → 1.0 (fuzzy ≥0.9);
person exact → 0.95, initial+surname ("R. Sharma") → 0.80, subset/fuzzy
≥0.75; location/org exact → 0.90, fuzzy ≥0.85. Persons block on
(surname, first-initial) so variants meet; threshold `SUGGEST_THRESHOLD =
0.75` (`AUTO_MERGE_THRESHOLD = 0.99` is reserved — **even phone anchors
require investigator confirmation**). New pairs only; SHO approves merges.

## 7. `index_evidence` — RAG indexing

`chunk_text`: sentence-aware greedy packing, `CHUNK_CHARS = 800`,
`OVERLAP_CHARS = 100`. `embed_texts` batches 16 through Gemini
`text-embedding-004` (768d); per-item `None` on failure; **no key →
all-`None`, keyword-only retrieval** (never fake vectors). Reindex is
delete + recreate (idempotent). Command: `reindex --all | --fir`.

## 8. Graph analytics (GDS 2.9.0, live)

Per-case Cypher projection (`id(n)` nodes, confidence-weighted rels, graph
dropped in `finally`): `degree` undirected, `pageRank` weighted, directed
`betweenness` (GDS 2.x rejects `orientation` there — verified), `wcc` +
`louvain`. Bridges = nodes touching ≥2 Louvain communities + top-betweenness
brokers. Each algorithm is individually try/excepted — failures omit that
metric with a note. Risk = pinned v1 weights (centrality .30, brokerage
.25, connectivity .20, cross-case .15, evidence .10; high ≥.60, medium
≥.35), every computation persisted as a `RiskReport`. Anomalies are
transparent statistics (hub z>2 with n≥4; ≥3 same-date edges burst;
community mean confidence <.5 with ≥2 edges) — sklearn/torch are
documented swap-ins, not installed. See
[analytics-and-risk-scoring](../features/analytics-and-risk-scoring.md).

## 9. Gemini RAG copilot

Intent router first (regex, no LLM): *path* ("how is X connected to Y",
"A → B") → Neo4j `shortestPath` (≤4 hops) verbalized hop-by-hop with
per-hop evidence; unconfirmed endpoints get a "confirm it first" answer.
*Summary* → GDS + risk rollup, templated. *Generic* → hybrid retrieval
(pgvector cosine top-k, then postgres full-text `websearch` rank to fill
`RAG_TOP_K = 6`, sqlite icontains fallback) → Gemini `gemini-2.0-flash`
generation **grounded on numbered excerpts with cite-or-decline
instructions**, or an honestly-labeled extractive answer without a key.
Why RAG, not a chatbot: every claim must cite evidence, and the corpus is
case-scoped per query — the model never freelances from training data.
