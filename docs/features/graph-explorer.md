# Graph Explorer

Route `/cases/[id]`. Cytoscape (cose layout) rendering the live Neo4j
subgraph; every node/edge click opens the **Why? evidence panel** with
label, confidence, validity date, extraction timestamp/engine, evidence
snippet, and source document (name, classification, truncated SHA-256,
uploader) fetched from the evidence detail endpoint.

## Controls that actually exist

- **Filter toolbar**: entity-type toggles, confidence slider, from/to date
  range → debounced refetch with `?types=&min_confidence=&date_from=&date_to=`.
  Undated edges always pass date filters (documented in-app).
- **Expand node**: panel button, 1–3 degrees, merges into the live canvas
  with an animated re-layout (`GET graph/expand/?node=&depth=`, clamped).
- **Rebuild graph**: enqueues `build_temporal_graph` from confirmed rows.
- **Saved views + time comparison** (`SnapshotManager`): save the current
  filtered view with a label; reload any snapshot; A-vs-B diff panel
  (added/removed nodes + edges); date-based "what changed" via
  `GET /api/analytics/case/{id}/compare/?from=&to=`.
- **Timeline** (`TimelineList`): dated edges oldest-first with snippets.
- **Replay** (`replay.tsx`): slider walks sorted `valid_from` dates,
  batch show/hide per step, undated-edges toggle, exit restores all.

## Evidence model behind the panel

Node payload: `{id (the Neo4j key), label, type, confidence,
source_evidence_id}`. Edge payload adds `snippet`, `extracted_on`,
`extracted_by`, `valid_from`. Keys look like `1:Person:rahul sharma`
(`{case}:{type}:{normalized}`) — see [neo4j-schema](../data-model/neo4j-schema.md).

## ⚠️ Explicitly not built

- `what_if` (arrest-prioritization simulation): the service returns
  `"impact": "not-computed"` and no route exposes it. Date-compare and
  snapshot diff are the real "what changed" tools.
- Manual coordinate pinning (`PATCH …/locate/`) and the geo-nearby query
  have **no UI** — the map shows points, hotspots, and movement trails
  only. Use the API for those two.
