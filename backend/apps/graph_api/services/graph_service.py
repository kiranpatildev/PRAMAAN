"""Graph-write layer — the ONLY place Neo4j is touched (§10.2).

Non-negotiable: every node/edge carries source_evidence_id, confidence_score,
extracted_by, extracted_on, valid_from/valid_to. Views/tasks must call
GraphService, never embed Cypher directly.

Node identity: `key = f"{case_id}:{node_type}:{normalized}"` with a `:Case`
scoped label so MERGE is idempotent and re-runnable per case.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

EDGE_TYPES = {
    "CALLED", "MET_AT", "OWNS", "TRANSFERRED_MONEY_TO",
    "RELATED_TO", "EMPLOYED_BY", "PRESENT_AT", "ASSOCIATED_WITH",
}
NODE_TYPES = {"Person", "Organization", "Location", "Vehicle", "PhoneNumber", "Event"}

# Canonical property sets — the single source of truth for what lives on
# graph nodes/edges. upsert_* build their records from these lists, and the
# NL-to-Cypher schema injector reads them, so a schema change updates the
# copilot prompt automatically (never a static string in a prompt).
NODE_PROPS = (
    "key", "case_id", "node_type", "value", "normalized",
    "confidence_score", "source_evidence_id", "extracted_by",
    "extracted_on", "valid_from", "valid_to",
)
EDGE_PROPS = (
    "case_id", "confidence_score", "source_evidence_id", "snippet",
    "extracted_by", "extracted_on", "valid_from", "valid_to",
)
# Every node also carries the :Case label (MERGE uses it for idempotency);
# every read path filters on case_id. The NL-to-Cypher verifier enforces
# both facts on generated queries.
GRAPH_NODE_LABEL = "Case"


class GraphUnavailable(RuntimeError):
    """Raised when the Neo4j driver is missing or the database unreachable."""


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def node_key(case_id: int, node_type: str, normalized: str) -> str:
    return f"{case_id}:{node_type}:{normalized}"


def _one(value):
    """APOC 'combine' merges can leave list-valued props; first wins."""
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return value


@dataclass
class GraphService:
    uri: str = field(default_factory=lambda: os.environ.get("NEO4J_URI", "bolt://localhost:7687"))
    user: str = field(default_factory=lambda: os.environ.get("NEO4J_USER", "neo4j"))
    password: str = field(default_factory=lambda: os.environ.get("NEO4J_PASSWORD", "pramaan-neo4j"))

    def _driver(self):
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise GraphUnavailable("neo4j driver not installed") from exc
        try:
            driver = GraphDatabase.driver(self.uri, auth=(self.user, self.password))
            driver.verify_connectivity()
            return driver
        except Exception as exc:
            raise GraphUnavailable(f"cannot reach Neo4j at {self.uri}: {exc}") from exc

    # -- reads ------------------------------------------------------------
    def get_case_graph(self, case_id: int, limit: int = 500, node_types: list[str] | None = None,
                       min_confidence: float = 0.0, date_from: str | None = None,
                       date_to: str | None = None) -> dict:
        """Filtered case subgraph. Undated edges always pass date filters
        (absence of a date is not evidence of irrelevance)."""
        if node_types:
            unknown = set(node_types) - NODE_TYPES
            if unknown:
                raise ValueError(f"unknown node types: {sorted(unknown)}")
        driver = self._driver()
        try:
            with driver.session() as session:
                nodes = {}
                for rec in session.run(
                        """MATCH (n:Case {case_id: $case})
                           WHERE ($types IS NULL OR n.node_type IN $types)
                             AND n.confidence_score >= $minconf
                           RETURN n LIMIT $limit""",
                        case=case_id, limit=limit, types=node_types, minconf=min_confidence):
                    props = {k: _one(v) for k, v in dict(rec["n"]).items()}
                    if props.get("key") is None:
                        continue
                    nodes[props["key"]] = props
                edges = []
                for rec in session.run(
                        """MATCH (a:Case {case_id: $case})-[r]->(b:Case {case_id: $case})
                           WHERE r.confidence_score >= $minconf
                             AND ($df IS NULL OR r.valid_from IS NULL OR r.valid_from >= $df)
                             AND ($dt IS NULL OR r.valid_from IS NULL OR r.valid_from <= $dt)
                             AND ($types IS NULL OR (a.node_type IN $types AND b.node_type IN $types))
                           RETURN a.key AS src, b.key AS dst, type(r) AS type, properties(r) AS props
                           LIMIT $limit""",
                        case=case_id, limit=limit, minconf=min_confidence,
                        df=date_from, dt=date_to, types=node_types):
                    p = {k: _one(v) for k, v in dict(rec["props"]).items()}
                    edges.append({
                        "id": f"{rec['src']}->{rec['type']}->{rec['dst']}",
                        "source": rec["src"], "target": rec["dst"], "label": rec["type"],
                        "confidence": p.get("confidence_score", 0.0),
                        "source_evidence_id": p.get("source_evidence_id"),
                        "snippet": p.get("snippet", ""),
                        "extracted_on": p.get("extracted_on", ""),
                        "extracted_by": p.get("extracted_by", ""),
                        "valid_from": p.get("valid_from"),
                    })
        finally:
            driver.close()
        return {
            "case_id": case_id,
            "filters": {"node_types": node_types, "min_confidence": min_confidence,
                        "date_from": date_from, "date_to": date_to},
            "nodes": [
                {"id": k, "label": v.get("value", k), "type": v.get("node_type", ""),
                 "confidence": v.get("confidence_score", 0.0),
                 "source_evidence_id": v.get("source_evidence_id")}
                for k, v in nodes.items()
            ],
            "edges": edges,
        }

    def expand_node(self, case_id: int, node_key_: str, depth: int = 1, limit: int = 200) -> dict:
        """N-degree neighborhood of one node (depth clamped to 1..3)."""
        depth = max(1, min(3, int(depth or 1)))
        driver = self._driver()
        try:
            with driver.session() as session:
                keys = {node_key_}
                rows = session.run(
                    f"""MATCH (s:Case {{key: $key, case_id: $case}})-[*1..{depth}]-(x:Case {{case_id: $case}})
                        RETURN DISTINCT x""",
                    key=node_key_, case=case_id)
                nbrs = {}
                for rec in rows:
                    props = {k: _one(v) for k, v in dict(rec["x"]).items()}
                    if props.get("key"):
                        nbrs[props["key"]] = props
                        keys.add(props["key"])
                keys = sorted(keys)
                edges = []
                for rec in session.run(
                        """MATCH (a:Case {case_id: $case})-[r]->(b:Case {case_id: $case})
                           WHERE a.key IN $keys AND b.key IN $keys
                           RETURN a.key AS src, b.key AS dst, type(r) AS type, properties(r) AS props
                           LIMIT $limit""", case=case_id, keys=keys, limit=limit):
                    p = {k: _one(v) for k, v in dict(rec["props"]).items()}
                    edges.append({
                        "id": f"{rec['src']}->{rec['type']}->{rec['dst']}",
                        "source": rec["src"], "target": rec["dst"], "label": rec["type"],
                        "confidence": p.get("confidence_score", 0.0),
                        "source_evidence_id": p.get("source_evidence_id"),
                        "snippet": p.get("snippet", ""),
                        "extracted_on": p.get("extracted_on", ""),
                        "extracted_by": p.get("extracted_by", ""),
                        "valid_from": p.get("valid_from"),
                    })
                center = session.run(
                    "MATCH (s:Case {key: $key, case_id: $case}) RETURN s",
                    key=node_key_, case=case_id).single()
                if center is not None:
                    props = {k: _one(v) for k, v in dict(center["s"]).items()}
                    nbrs.setdefault(props["key"], props)
        finally:
            driver.close()
        return {
            "case_id": case_id, "center": node_key_, "depth": depth,
            "nodes": [
                {"id": k, "label": v.get("value", k), "type": v.get("node_type", ""),
                 "confidence": v.get("confidence_score", 0.0),
                 "source_evidence_id": v.get("source_evidence_id")}
                for k, v in nbrs.items()
            ],
            "edges": edges,
        }

    def path_between(self, case_id: int, src_key: str, dst_key: str, max_hops: int = 4) -> dict | None:
        """Shortest evidence-backed path between two nodes (undirected search).

        Returns {nodes: [...], rels: [...]} with per-hop evidence, or None.
        """
        max_hops = max(1, min(5, int(max_hops or 4)))
        driver = self._driver()
        try:
            with driver.session() as session:
                rec = session.run(
                    f"""MATCH (a:Case {{key: $src, case_id: $case}}),
                             (b:Case {{key: $dst, case_id: $case}}),
                       p = shortestPath((a)-[*..{max_hops}]-(b))
                       RETURN [n IN nodes(p) | {{key: n.key, value: n.value, type: n.node_type,
                                                conf: n.confidence_score}}] AS nodes,
                              [r IN relationships(p) |
                                {{type: type(r), conf: r.confidence_score, snippet: r.snippet,
                                  ev: r.source_evidence_id, by: r.extracted_by, on: r.extracted_on,
                                  valid_from: r.valid_from}}] AS rels""",
                    src=src_key, dst=dst_key, case=case_id).single()
        finally:
            driver.close()
        if rec is None:
            return None
        return {"nodes": [dict(n) for n in rec["nodes"]],
                "rels": [{k: _one(v) for k, v in dict(r).items()} for r in rec["rels"]]}

    def timeline(self, case_id: int) -> dict:
        """Event sequence from dated edges (relations carry the time)."""
        driver = self._driver()
        try:
            with driver.session() as session:
                events = []
                for rec in session.run(
                        """MATCH (a:Case {case_id: $case})-[r]->(b:Case {case_id: $case})
                           WHERE r.valid_from IS NOT NULL
                           RETURN a.value AS src, b.value AS dst, type(r) AS type,
                                  r.valid_from AS valid_from, r.snippet AS snippet,
                                  r.source_evidence_id AS ev, r.confidence_score AS conf
                           ORDER BY r.valid_from LIMIT 500""", case=case_id):
                    events.append({
                        "from": rec["src"], "to": rec["dst"], "label": rec["type"],
                        "valid_from": _one(rec["valid_from"]),
                        "snippet": rec["snippet"] or "",
                        "source_evidence_id": rec["ev"],
                        "confidence": rec["conf"] or 0.0,
                    })
        finally:
            driver.close()
        return {"case_id": case_id, "events": events}

    def run_readonly(self, cypher: str, params: dict | None = None,
                     timeout_s: int = 10) -> list[dict]:
        """Execute a verifier-approved read query; return raw record dicts.

        The ONLY sanctioned path for executing non-hardcoded Cypher
        (NL-to-Cypher copilot). Callers must pass output of
        `nl_to_cypher.verify_and_scope` — this method does NOT re-verify,
        it only enforces the query timeout and maps driver records to plain
        dicts. Honest degradation via GraphUnavailable, same as all reads.
        """
        driver = self._driver()
        try:
            with driver.session() as session:
                result = session.run(cypher, parameters=dict(params or {}),
                                     timeout=float(timeout_s))
                rows = []
                for rec in result:
                    rows.append({k: _one(rec[k]) for k in rec.keys()})
                return rows
        finally:
            driver.close()

    # -- writes (Phase 3: extraction pipeline calls these) ------------------
    def upsert_entity(self, case_id: int, node_type: str, props: dict) -> dict:
        assert node_type in NODE_TYPES, f"unknown node type {node_type}"
        key = node_key(case_id, node_type, props.get("normalized", props.get("value", "")))
        defaults = {"case_id": case_id, "value": "", "normalized": "",
                    "confidence_score": 0.0, "extracted_by": "pipeline",
                    "extracted_on": utcnow_iso()}
        record = {k: props.get(k, defaults.get(k)) for k in NODE_PROPS}
        record["key"] = key
        record["case_id"] = case_id
        record["node_type"] = node_type
        driver = self._driver()
        try:
            with driver.session() as session:
                session.run(
                    f"""MERGE (n:Case:{node_type} {{key: $key}})
                       SET n += $props""",
                    key=key, props={k: v for k, v in record.items() if v is not None})
        finally:
            driver.close()
        return {"node_type": node_type, **record}

    def upsert_relationship(self, case_id: int, edge_type: str, src_key: str, dst_key: str, props: dict) -> dict:
        assert edge_type in EDGE_TYPES, f"unknown edge type {edge_type}"
        defaults = {"case_id": case_id, "confidence_score": 0.0, "snippet": "",
                    "extracted_by": "pipeline", "extracted_on": utcnow_iso()}
        record = {k: props.get(k, defaults.get(k)) for k in EDGE_PROPS}
        record["case_id"] = case_id
        driver = self._driver()
        try:
            with driver.session() as session:
                session.run(
                    f"""MATCH (a:Case {{key: $src, case_id: $case}}), (b:Case {{key: $dst, case_id: $case}})
                       MERGE (a)-[r:{edge_type}]->(b) SET r += $props""",
                    src=src_key, dst=dst_key, case=case_id,
                    props={k: v for k, v in record.items() if v is not None})
        finally:
            driver.close()
        return {"edge_type": edge_type, "from": src_key, "to": dst_key, **record}

    def merge_nodes(self, survivor_key: str, duplicate_key: str, survivor_props: dict | None = None) -> dict:
        """Merge duplicate into survivor, preserving relationship types.

        Uses APOC (installed via NEO4J_PLUGINS in docker-compose) so edge types
        and their evidence properties survive the merge. APOC 'combine' mode
        would leave list-valued props on conflicting scalars, so the
        survivor's identity props are SET explicitly afterwards — the merged
        node's key/type/value/confidence are always deterministic scalars.
        """
        survivor_props = survivor_props or {}
        driver = self._driver()
        try:
            with driver.session() as session:
                rec = session.run(
                    """MATCH (s {key: $surv}), (d {key: $dup})
                       CALL apoc.refactor.mergeNodes([s, d],
                         {properties: 'combine', mergeRels: true}) YIELD node
                       SET node.key = $surv,
                           node.node_type = coalesce($ntype, node.node_type),
                           node.value = coalesce($val, node.value),
                           node.normalized = coalesce($norm, node.normalized),
                           node.confidence_score = coalesce($conf, node.confidence_score),
                           node.source_evidence_id = coalesce($ev, node.source_evidence_id),
                           node.extracted_by = 'merge'
                       RETURN node.key AS key""",
                    surv=survivor_key, dup=duplicate_key,
                    ntype=survivor_props.get("node_type"), val=survivor_props.get("value"),
                    norm=survivor_props.get("normalized"), conf=survivor_props.get("confidence_score"),
                    ev=survivor_props.get("source_evidence_id")).single()
        finally:
            driver.close()
        return {"survivor": survivor_key, "duplicate": duplicate_key,
                "merged": bool(rec)}
