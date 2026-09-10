"""Cross-case connection discovery with strict access control.

An entity shared across cases is only reported when >=2 *visible* cases share
it. Cases the caller cannot see never leak — not even as counts. Pass
visible=None for SHO/admin (all cases), else the caller's visible case ids.
"""
from __future__ import annotations

from django.db.models import Count

from apps.graph_api.models import ExtractedEntity


def shared_entities(visible_case_ids: list[int] | None, limit: int = 100) -> list[dict]:
    qs = ExtractedEntity.objects.exclude(status="rejected")
    if visible_case_ids is not None:
        qs = qs.filter(case_id__in=visible_case_ids)
    groups = (qs.values("node_type", "normalized")
              .annotate(cases=Count("case", distinct=True))
              .filter(cases__gte=2)
              .order_by("-cases")[:limit])
    out = []
    for g in groups:
        members = (ExtractedEntity.objects
                   .filter(node_type=g["node_type"], normalized=g["normalized"])
                   .exclude(status="rejected")
                   .select_related("case")
                   .order_by("-confidence"))
        if visible_case_ids is not None:
            members = members.filter(case_id__in=visible_case_ids)
        members = list(members)
        case_ids = sorted({m.case_id for m in members})
        if len(case_ids) < 2:
            continue
        best = members[0]
        out.append({
            "node_type": g["node_type"], "normalized": g["normalized"],
            "value": best.value, "confidence": best.confidence,
            "cases": [{"id": m.case_id, "fir_no": m.case.fir_no, "title": m.case.title}
                      for m in members if m.case_id in case_ids][:10],
            "case_count": len(case_ids),
            "strength": round(min(len(case_ids) / 4.0, 1.0), 3),
        })
    return sorted(out, key=lambda r: (-r["case_count"], r["value"]))[:limit]


def cross_case_counts(visible_case_ids: list[int] | None) -> dict[str, int]:
    """{(node_type, normalized): visible-case count} — risk factor input."""
    qs = ExtractedEntity.objects.exclude(status="rejected")
    if visible_case_ids is not None:
        qs = qs.filter(case_id__in=visible_case_ids)
    rows = (qs.values("node_type", "normalized")
            .annotate(cases=Count("case", distinct=True)))
    return {(r["node_type"], r["normalized"]): r["cases"] for r in rows}
