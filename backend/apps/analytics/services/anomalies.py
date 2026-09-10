"""Unusual-pattern detection with transparent statistics (Phase 5).

Demo-grade by choice: z-scores and count rules need no training data and every
flag cites its evidence. Larger deployments can swap sklearn IsolationForest /
torch graph models behind `detect()`'s contract (see requirements-ml.txt).

Rules (within one case):
  hub_outlier ............ degree z-score > 2 (n >= 4 nodes)
  contact_burst .......... >=3 edges on a node sharing one valid_from date
  weak_evidence_community  Louvain community (≥2 edges) with mean edge
                           confidence < 0.5 — a data-quality flag, not guilt
Each anomaly: {kind, severity, node refs, explanation, evidence edge ids}.
"""
from __future__ import annotations

import statistics

HUB_Z = 2.0
BURST_EDGES = 3
WEAK_CONF = 0.5


def detect(nodes: dict, edges: list[dict], communities: list[dict] | None = None) -> list[dict]:
    """nodes: {key: {label, type, degree, ...}}; edges: API-shaped edge dicts."""
    anomalies: list[dict] = []
    anomalies.extend(_hubs(nodes))
    anomalies.extend(_bursts(nodes, edges))
    anomalies.extend(_weak_communities(edges, communities or []))
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(anomalies, key=lambda a: (severity_rank[a["severity"]], a["kind"]))


def _hubs(nodes: dict) -> list[dict]:
    degrees = [n.get("degree", 0) for n in nodes.values()]
    if len(degrees) < 4:
        return []
    mean = statistics.fmean(degrees)
    stdev = statistics.pstdev(degrees)
    if stdev == 0:
        return []
    out = []
    for key, n in nodes.items():
        z = (n.get("degree", 0) - mean) / stdev
        if z > HUB_Z:
            out.append({
                "kind": "hub_outlier", "severity": "medium",
                "nodes": [{"key": key, "label": n.get("label", key)}],
                "explanation": (
                    f"{n.get('label', key)} has degree {n.get('degree', 0)} vs case mean "
                    f"{mean:.1f} (z={z:.1f}): unusually connected — verify whether this "
                    f"reflects real influence or extraction over-linking."),
                "evidence": {"degree": n.get("degree", 0), "z": round(z, 2)},
            })
    return out


def _bursts(nodes: dict, edges: list[dict]) -> list[dict]:
    by_node_date: dict[tuple[str, str], list[dict]] = {}
    for e in edges:
        if not e.get("valid_from"):
            continue
        for end in (e["source"], e["target"]):
            by_node_date.setdefault((end, e["valid_from"]), []).append(e)
    out = []
    for (key, day), es in by_node_date.items():
        if len(es) >= BURST_EDGES:
            label = nodes.get(key, {}).get("label", key)
            out.append({
                "kind": "contact_burst", "severity": "high",
                "nodes": [{"key": key, "label": label}],
                "explanation": (
                    f"{len(es)} connections involving {label} all date to {day}: sudden "
                    f"new-contact burst (or single-document artefact — check sources)."),
                "evidence": {"date": day, "edge_ids": [e["id"] for e in es],
                             "snippets": [e.get("snippet", "") for e in es][:3]},
            })
    return out


def _weak_communities(edges: list[dict], communities: list[dict]) -> list[dict]:
    member_of: dict[str, str] = {}
    for c in communities:
        for m in c.get("members", []):
            member_of[m] = c["id"]
    by_comm: dict[str, list[dict]] = {}
    for e in edges:
        cid = member_of.get(e["source"])
        if cid and member_of.get(e["target"]) == cid:
            by_comm.setdefault(cid, []).append(e)
    out = []
    for cid, es in by_comm.items():
        if len(es) >= 2:
            mean = statistics.fmean(e.get("confidence", 0) for e in es)
            if mean < WEAK_CONF:
                out.append({
                    "kind": "weak_evidence_community", "severity": "low",
                    "nodes": [],
                    "explanation": (
                        f"Community {cid} ({len(es)} internal edges) averages "
                        f"{mean:.0%} confidence: treat its links as leads, gather stronger evidence."),
                    "evidence": {"community": cid, "mean_confidence": round(mean, 3),
                                 "edge_ids": [e["id"] for e in es]},
                })
    return out
