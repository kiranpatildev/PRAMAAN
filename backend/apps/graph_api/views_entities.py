from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.permissions import visible_case_ids as _visible_case_ids

from .models import ExtractedEntity
from .serializers import ExtractedEntitySerializer, ExtractedRelationSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def entity_search(request):
    """Cross-case entity search with strict case-level access control."""
    from .models import ExtractedRelation  # noqa: F401 (kept for symmetry w/ detail)

    q = (request.query_params.get("q") or "").strip()
    if not q:
        return Response({"results": []})
    qs = ExtractedEntity.objects.select_related("case", "evidence").exclude(status="rejected")
    allowed = _visible_case_ids(request.user)
    if allowed is not None:
        qs = qs.filter(case_id__in=allowed)
    node_type = request.query_params.get("type")
    if node_type:
        qs = qs.filter(node_type=node_type)
    qs = qs.filter(Q(value__icontains=q) | Q(normalized__icontains=q))[:50]
    return Response({"results": ExtractedEntitySerializer(qs, many=True).data, "query": q})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def entity_detail(request, pk):
    """Entity detail with evidence trail: every edge shows source + snippet."""
    from .models import ExtractedRelation

    try:
        ent = ExtractedEntity.objects.select_related("case", "evidence").get(pk=pk)
    except ExtractedEntity.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    allowed = _visible_case_ids(request.user)
    if allowed is not None and ent.case_id not in allowed:
        return Response({"detail": "Forbidden."}, status=403)
    rels = (ExtractedRelation.objects.filter(Q(src=ent) | Q(dst=ent))
            .select_related("src", "dst", "evidence")[:100])
    return Response({
        "entity": ExtractedEntitySerializer(ent).data,
        "evidence_trail": ExtractedRelationSerializer(rels, many=True).data,
    })
