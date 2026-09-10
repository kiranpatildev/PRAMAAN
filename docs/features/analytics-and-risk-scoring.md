# Analytics & Risk Scoring

UI: `AnalyticsPanel` on the case page (key-players table with per-factor
tooltips, bridges, communities, anomaly feed, risk history, recompute) +
**risk overlay** that rings graph nodes red/amber/green +
`CrossCasePanel` on the dashboard + `DistrictPanel`.

## GDS workup (`GET …/analytics/case/{id}/overview/`)

`gds.case_metrics`: Cypher-projects the case subgraph into memory, runs
**degree** (undirected), **PageRank** (confidence-weighted directed),
**betweenness** (directed — GDS 2.x rejects `orientation` there),
**WCC + Louvain** communities, then drops the projection in `finally`.
Response: top-15 players sorted by PageRank, `bridges` (multi-community
links + shortest-path brokers), community roster, `counts`, `engine`
(e.g. `gds-2.9.0`), and `notes` for any algorithm that failed (omitted,
never faked). GDS down → 503.

## Risk (`GET …/risk/`, auto-persists a `RiskReport`)

`risk.score_nodes`, pinned `WEIGHTS_VERSION = "v1"`:

| Factor | Weight | Meaning |
|---|---|---|
| centrality | 0.30 | PageRank / max PageRank |
| brokerage | 0.25 | betweenness / max betweenness |
| connectivity | 0.20 | degree / max degree |
| cross_case | 0.15 | min(cases−1, 3)/3 across visible cases |
| evidence | 0.10 | node extraction confidence |

Levels: high ≥ 0.60, medium ≥ 0.35, else low. Every score ships its full
factor breakdown (hover the badge); the persisted report makes any past
score reproducible. History at `risk/history/`.

## Anomalies (`GET …/anomalies/`)

Transparent statistics, no training data: **hub_outlier** (degree z > 2,
needs ≥4 nodes), **contact_burst** (≥3 edges sharing one `valid_from`
date — high severity), **weak_evidence_community** (≥2 internal edges,
mean confidence < 0.5 — a data-quality flag, not guilt). Each cites node
refs + edge ids. sklearn/torch are documented swap-ins, not installed.

## Cross-case (`GET …/cross-case/`)

Entities in ≥2 **mutually-visible** cases (hidden cases never leak — not
even as counts; outsiders provably see nothing). Also feeds the risk
`cross_case` factor and the post-extraction alert fan-out (strict: notify
only users seeing *all* involved cases).

## District (`GET …/districts/`, `district/?district=`)

Caseload totals + status/risk splits, investigator workload (active cases,
pending reviews), weekly evidence growth, top shared entities.
Aggregates only — safe for any authenticated user.
