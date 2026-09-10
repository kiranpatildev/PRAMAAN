"""Global search (Phase 6): entities + evidence + cases in one scoped query.

Postgres: trigram similarity (typo tolerance) + full-text rank.
Elsewhere: icontains fallback (documented degradation). Case scoping first —
a hit the caller cannot see is never returned.
"""
from django.db import connection
from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_view_case, visible_case_ids
from apps.evidence.models import Evidence
from apps.graph_api.models import ExtractedEntity

DEFAULT_LIMIT = 10
TRIGRAM_FLOOR = 0.15


def _trigram(model_field: str, query: str):
    from django.contrib.postgres.search import TrigramSimilarity
    return TrigramSimilarity(model_field, query)


def _entity_hits(q, case_ids, node_type, limit):
    qs = (ExtractedEntity.objects.exclude(status="rejected")
          .select_related("case", "evidence"))
    if case_ids is not None:
        qs = qs.filter(case_id__in=case_ids)
    if node_type:
        qs = qs.filter(node_type=node_type)
    if connection.vendor == "postgresql":
        qs = (qs.annotate(sim=_trigram("value", q))
              .filter(Q(sim__gt=TRIGRAM_FLOOR) | Q(value__icontains=q))
              .order_by("-sim", "-confidence"))
    else:
        qs = qs.filter(value__icontains=q).order_by("-confidence")
    return [{
        "id": e.id, "value": e.value, "node_type": e.node_type, "status": e.status,
        "confidence": e.confidence, "case_id": e.case_id, "case_fir": e.case.fir_no,
        "evidence_id": e.evidence_id,
        "evidence_file": e.evidence.file_name if e.evidence_id else "",
    } for e in qs[:limit]]


def _evidence_hits(q, case_ids, limit):
    qs = Evidence.objects.select_related("case", "uploaded_by")
    if case_ids is not None:
        qs = qs.filter(case_id__in=case_ids)
    if connection.vendor == "postgresql":
        from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
        vector = SearchVector("ocr_text", config="english")
        squery = SearchQuery(q, config="english", search_type="websearch")
        name_qs = (qs.annotate(sim=_trigram("file_name", q))
                   .filter(Q(sim__gt=TRIGRAM_FLOOR) | Q(file_name__icontains=q))
                   .order_by("-sim"))
        text_qs = (qs.annotate(rank=SearchRank(vector, squery))
                   .filter(rank__gt=0).order_by("-rank"))
        seen, out = set(), []
        for e in list(name_qs[:limit]) + list(text_qs[:limit]):
            if e.id in seen:
                continue
            seen.add(e.id)
            out.append(_evidence_row(e))
            if len(out) >= limit:
                break
        return out
    rows = qs.filter(Q(file_name__icontains=q) | Q(ocr_text__icontains=q))[:limit]
    return [_evidence_row(e) for e in rows]


def _evidence_row(e):
    return {
        "id": e.id, "file_name": e.file_name, "classification": e.classification,
        "ocr_status": e.ocr_status, "case_id": e.case_id, "case_fir": e.case.fir_no,
        "sha256": e.sha256[:16], "snippet": (e.ocr_text or "")[:220],
        "created_at": e.created_at,
    }


def _case_hits(q, case_ids, limit):
    qs = Case.objects.all()
    if case_ids is not None:
        qs = qs.filter(id__in=case_ids)
    if connection.vendor == "postgresql":
        qs = (qs.annotate(sim=_trigram("fir_no", q))
              .filter(Q(sim__gt=TRIGRAM_FLOOR) | Q(fir_no__icontains=q) | Q(title__icontains=q))
              .order_by("-sim", "-created_at"))
    else:
        qs = qs.filter(Q(fir_no__icontains=q) | Q(title__icontains=q)).order_by("-created_at")
    return [{
        "id": c.id, "fir_no": c.fir_no, "title": c.title, "status": c.status,
        "risk_level": c.risk_level, "district": c.district,
    } for c in qs[:limit]]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def global_search(request):
    q = (request.query_params.get("q") or "").strip()
    if len(q) < 2:
        return Response({"query": q, "entities": [], "evidence": [], "cases": []})
    try:
        limit = max(1, min(50, int(request.query_params.get("limit", DEFAULT_LIMIT))))
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    case_filter = request.query_params.get("case_id")
    allowed = visible_case_ids(request.user)
    if case_filter:
        try:
            case = Case.objects.get(pk=int(case_filter))
        except (Case.DoesNotExist, ValueError):
            return Response({"detail": "Case not found."}, status=404)
        if not user_can_view_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        allowed = [case.id]
    node_type = request.query_params.get("type") or None
    return Response({
        "query": q,
        "entities": _entity_hits(q, allowed, node_type, limit),
        "evidence": _evidence_hits(q, allowed, limit),
        "cases": _case_hits(q, allowed, limit),
    })
