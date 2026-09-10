"""Neo4j GDS analytics — centrality, communities, bridges (Phase 5).

Per-case in-memory projection (Cypher projection, strictly case-scoped):
  degree (undirected) · pageRank (confidence-weighted, directed) ·
  betweenness (directed — GDS 2.x accepts no orientation key for it) ·
  WCC + Louvain (communities).

Bridges/brokers are derived transparently on top:
  inter-community bridge = edges into >=2 Louvain communities;
  broker = top betweenness with degree >= 2 (lies on many shortest paths).

Honesty rules: the GDS version is reported; a failing algorithm omits its
metric with a note instead of faking numbers; degree on the projection is
exact. Everything is keyed by our stable node key `{case}:{type}:{normalized}`.
"""
from __future__ import annotations

import logging
import uuid

log = logging.getLogger(__name__)

NODE_QUERY = "MATCH (n:Case {case_id: $case}) RETURN id(n) AS id"
REL_QUERY = (
    "MATCH (a:Case {case_id: $case})-[r]->(b:Case {case_id: $case}) "
    "RETURN id(a) AS source, id(b) AS target, coalesce(r.confidence_score, 0.5) AS weight"
)


def _project(session, name: str, case_id: int) -> None:
    session.run(
        "CALL gds.graph.project.cypher($name, $nq, $rq, {parameters: {case: $case}})",
        name=name, nq=NODE_QUERY, rq=REL_QUERY, case=case_id,
    ).consume()


def _stream(session, query: str, name: str, extra: dict | None = None) -> dict[int, float]:
    params = {"name": name}
    if extra:
        params.update(extra)
    return {rec["nodeId"]: rec["score"] for rec in session.run(query, **params)}


def _communities(session, query: str, name: str, field: str) -> dict[int, int]:
    return {rec["nodeId"]: rec[field] for rec in session.run(query, name=name)}


def _resolve_keys(session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return {rec["i"]: rec["k"] for rec in session.run(
        "MATCH (n) WHERE id(n) IN $ids RETURN id(n) AS i, n.key AS k", ids=list(ids))}


def case_metrics(case_id: int) -> dict:
    """Full GDS workup for one case. Never raises for graph problems —
    degraded metrics come with notes; only a dead database raises."""
    from apps.graph_api.services.graph_service import GraphService, GraphUnavailable

    try:
        svc = GraphService()
        driver = svc._driver()
    except GraphUnavailable:
        raise
    try:
        engine = driver.execute_query("RETURN gds.version() AS v")[0][0]["v"]
    except Exception as exc:
        driver.close()
        raise GraphUnavailable(f"GDS unavailable: {exc}") from exc

    graph = GraphService().get_case_graph(case_id, limit=5000)
    nodes = {n["id"]: n for n in graph["nodes"]}
    edges = [(e["source"], e["target"]) for e in graph["edges"]]
    metrics = {k: {"degree": 0, "pagerank": 0.0, "betweenness": 0.0, "wcc": 0, "louvain": 0}
               for k in nodes}
    notes: list[str] = []
    if not edges:
        notes.append("no edges: centrality trivially zero")
        return _result(case_id, engine, nodes, metrics, edges, notes)

    name = f"case_{case_id}_{uuid.uuid4().hex[:8]}"
    try:
        with driver.session() as session:
            _project(session, name, case_id)
            runs = [
                ("degree", "CALL gds.degree.stream($name, {orientation: 'UNDIRECTED'}) YIELD nodeId, score",
                 "score", "degree"),
                ("pagerank", "CALL gds.pageRank.stream($name, {relationshipWeightProperty: 'weight'}) YIELD nodeId, score",
                 "score", "pagerank"),
                ("betweenness", "CALL gds.betweenness.stream($name) YIELD nodeId, score",
                 "score", "betweenness"),
                ("wcc", "CALL gds.wcc.stream($name, {}) YIELD nodeId, componentId",
                 "componentId", "wcc"),
                ("louvain", "CALL gds.louvain.stream($name, {relationshipWeightProperty: 'weight'}) YIELD nodeId, communityId",
                 "communityId", "louvain"),
            ]
            raw: dict[str, dict] = {}
            for algo, query, field, _slot in runs:
                try:
                    if algo in ("wcc", "louvain"):
                        raw[algo] = _communities(session, query, name, field)
                    else:
                        raw[algo] = _stream(session, query, name)
                except Exception as exc:
                    notes.append(f"{algo} omitted: {str(exc)[:120]}")
                    raw[algo] = {}
            ids = set()
            for r in raw.values():
                ids.update(r.keys())
            key_by_id = _resolve_keys(session, ids)
            for algo, mapping in raw.items():
                slot = {"degree": "degree", "pagerank": "pagerank", "betweenness": "betweenness",
                        "wcc": "wcc", "louvain": "louvain"}[algo]
                for nid, value in mapping.items():
                    key = key_by_id.get(nid)
                    if key in metrics:
                        metrics[key][slot] = value
    finally:
        try:
            with driver.session() as session:
                session.run("CALL gds.graph.drop($name)", name=name).consume()
        except Exception:
            pass
        driver.close()
    return _result(case_id, engine, nodes, metrics, edges, notes)


def _result(case_id, engine, nodes, metrics, edges, notes) -> dict:
    neighbors: dict[str, set[str]] = {k: set() for k in nodes}
    for a, b in edges:
        if a in neighbors:
            neighbors[a].add(b)
        if b in neighbors:
            neighbors[b].add(a)
    enriched = {}
    for key, node in nodes.items():
        m = metrics[key]
        enriched[key] = {"key": key, "label": node["label"], "type": node["type"],
                         "confidence": node["confidence"],
                         "source_evidence_id": node["source_evidence_id"], **m}
    communities: dict[str, list[str]] = {}
    for key, m in metrics.items():
        communities.setdefault(f"louvain-{m['louvain']}", []).append(key)
    bridges = []
    for key, m in metrics.items():
        linked = {metrics[n]["louvain"] for n in neighbors.get(key, set()) if n in metrics}
        kinds = []
        if len(linked) >= 2:
            kinds.append(f"links {len(linked)} communities")
        if m["betweenness"] > 0 and m["degree"] >= 2:
            kinds.append("lies on shortest paths (broker)")
        if kinds:
            bridges.append({"key": key, "label": nodes[key]["label"], "type": nodes[key]["type"],
                            "kinds": kinds, "degree": m["degree"],
                            "betweenness": round(m["betweenness"], 4)})
    bridges.sort(key=lambda b: -b["betweenness"])
    return {
        "case_id": case_id, "engine": f"gds-{engine}",
        "nodes": enriched,
        "bridges": bridges,
        "communities": [{"id": cid, "size": len(members), "members": sorted(members)}
                        for cid, members in sorted(communities.items())],
        "counts": {"nodes": len(nodes), "edges": len(edges),
                   "communities": len(communities), "bridges": len(bridges)},
        "notes": notes,
    }
