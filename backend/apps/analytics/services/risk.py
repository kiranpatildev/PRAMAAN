"""Explainable network-significance scoring (auditable by design).

score = Σ weight_i · factor_i, every factor in [0,1], weights sum to 1.
WEIGHTS_VERSION pins the formula; each computed assessment is persisted
(RiskReport) with its full factor breakdown, so any score is reproducible
and challengeable — no black-box claims (§4.4, §5).

Factors:
  centrality   pagerank / max pagerank ............ influential position
  brokerage    betweenness / max betweenness ...... gatekeeper potential
  connectivity degree / max degree ................ raw embeddedness
  cross_case   min(cases-1, 3) / 3 ................. spans investigations
  evidence     node extraction confidence ......... how well-evidenced
"""
from __future__ import annotations

WEIGHTS_VERSION = "v1"
WEIGHTS = {
    "centrality": 0.30,
    "brokerage": 0.25,
    "connectivity": 0.20,
    "cross_case": 0.15,
    "evidence": 0.10,
}

REASONS = {
    "centrality": "PageRank position in the case network (GDS, confidence-weighted)",
    "brokerage": "Betweenness: fraction of shortest paths through this node (GDS)",
    "connectivity": "Share of the case's maximum degree",
    "cross_case": "Appears in multiple visible cases (capped at 3 extra)",
    "evidence": "Mean extraction confidence of the node's evidence",
}


def level_for(score: float) -> str:
    if score >= 0.60:
        return "high"
    if score >= 0.35:
        return "medium"
    return "low"


def score_nodes(nodes: dict, cross_case_counts: dict[str, int] | None = None) -> list[dict]:
    """Score GDS-enriched nodes.

    nodes: {key: {label, type, confidence, pagerank, betweenness, degree, ...}}
    cross_case_counts: {key: visible-case count} (default: all single-case).
    Returns score-descending [{key, label, type, score, level, factors}].
    """
    cross_case_counts = cross_case_counts or {}
    max_pr = max([n.get("pagerank", 0.0) for n in nodes.values()] + [0.0])
    max_bw = max([n.get("betweenness", 0.0) for n in nodes.values()] + [0.0])
    max_dg = max([n.get("degree", 0) for n in nodes.values()] + [0])
    scored = []
    for key, n in nodes.items():
        factors = [
            ("centrality", (n.get("pagerank", 0.0) / max_pr) if max_pr else 0.0),
            ("brokerage", (n.get("betweenness", 0.0) / max_bw) if max_bw else 0.0),
            ("connectivity", (n.get("degree", 0) / max_dg) if max_dg else 0.0),
            ("cross_case", min(max(cross_case_counts.get(key, 1) - 1, 0), 3) / 3.0),
            ("evidence", float(n.get("confidence", 0.0) or 0.0)),
        ]
        breakdown = [{
            "name": name, "value": round(val, 4), "weight": WEIGHTS[name],
            "contribution": round(val * WEIGHTS[name], 4), "reason": REASONS[name],
        } for name, val in factors]
        score = round(sum(f["contribution"] for f in breakdown), 4)
        scored.append({"key": key, "label": n.get("label", key), "type": n.get("type", ""),
                       "score": score, "level": level_for(score), "factors": breakdown})
    return sorted(scored, key=lambda s: -s["score"])
