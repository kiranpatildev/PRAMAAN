# Graph Layer — Neo4j Schema & Service Contract

Neo4j 5.21 Community (+ GDS 2.9.0, APOC 5.21.2 — versions measured live)
holds **only confirmed knowledge**. Everything pending lives in Postgres
(`ExtractedEntity`/`ExtractedRelation`); nothing reaches Neo4j until an
investigator confirms it and `build_temporal_graph` MERGEd it.

## The one rule

`apps/graph_api/services/graph_service.py` is the **only** file that may
import the Neo4j driver or embed Cypher. Views and tasks call `GraphService`
methods. (`GraphUnavailable` is raised when the driver is missing or the
database unreachable; reads degrade to `{live: false}`, writes fail the
calling task loudly.)

## Node identity

`key = f"{case_id}:{node_type}:{normalized}"`, e.g.
`1:Person:rahul sharma`. Nodes carry a `:Case` scoping label **plus** their
type label:

```cypher
MERGE (n:Case:Person {key: $key}) SET n += $props
```

Same person in two cases = two nodes (case isolation is structural, not a
convention). Cross-case linkage is computed in Postgres
(`crosscase.shared_entities`), never by merging graph nodes.

## Node types actually written

`Person`, `Organization`, `Location`, `Vehicle`, `PhoneNumber`
(`NODE_TYPES` also lists `Event`, but the extractor never creates Event
nodes — ⚠️ defined but unused).

Every node carries: `key`, `case_id`, `node_type`, `value` (display form),
`normalized`, `confidence_score`, `source_evidence_id`, `extracted_by`
(`pipeline` or `review-confirm:{engine}`), `extracted_on` (ISO),
`valid_from`, `valid_to` (accepted but ⚠️ **never populated** by the
pipeline — temporal filtering runs on edge dates).

## Relationship types

Declared in `EDGE_TYPES`: `CALLED`, `MET_AT`, `OWNS`,
`TRANSFERRED_MONEY_TO`, `RELATED_TO`, `EMPLOYED_BY`, `PRESENT_AT`,
`ASSOCIATED_WITH`. Actually emitted by `extract_relations`: all **except**
`MET_AT` (⚠️ declared, never emitted).

Every edge carries the same provenance block as nodes **plus `snippet`**
(the evidence sentence — the "why" shown in the UI).

```cypher
MATCH (a:Case {key: $src, case_id: $case}), (b:Case {key: $dst, case_id: $case})
MERGE (a)-[r:CALLED]->(b) SET r += $props
```

## Read methods (all case-scoped, default limit 500/5000)

| Method | Cypher idea | Used by |
|---|---|---|
| `get_case_graph(case, limit, node_types, min_confidence, date_from/to)` | `MATCH (n:Case {case_id})` + filtered `MATCH (a)-[r]->(b)`; **undated edges always pass date filters** | explorer, snapshots, compare, replay |
| `expand_node(case, key, depth)` | `-[*1..N]-` neighborhood (N clamped 1–3, int-interpolated — no injection surface), then internal edges | Expand button |
| `path_between(case, src, dst, max_hops≤5)` | `shortestPath((a)-[*..N]-(b))`, nodes+rels with evidence | copilot path answers |
| `timeline(case)` | dated edges `ORDER BY valid_from` | timeline + replay |

## Write/merge methods

- `upsert_entity` / `upsert_relationship`: idempotent MERGEs (re-runnable
  builds), `None` props stripped before `SET`.
- `merge_nodes(survivor, duplicate, survivor_props)`: APOC
  `mergeNodes([s, d], {combine, mergeRels: true})` **then explicitly SETs**
  the survivor's scalar identity (key/type/value/confidence) — because
  combine-mode would otherwise leave list-valued props. Reads defensively
  take the first element (`_one()`) anyway.

## ⚠️ Stub surface in this file

`snapshot()` / `diff()` return canned dicts and `what_if()` returns
`"impact": "not-computed"` — and the matching `GraphViewSet.snapshot/diff/
what_if` actions have **no URL routes** (dead code). The real snapshot/diff
feature is Postgres-backed (`views_snapshots.py` + `GraphSnapshot` model);
true what-if simulation was never built. Note `views.py` also defines
`timeline` **twice** — the second (unguarded) definition wins, so a down
Neo4j 500s on `/timeline/` instead of returning the graceful fallback the
first definition implements.
