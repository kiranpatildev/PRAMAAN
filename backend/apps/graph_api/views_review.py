"""Investigator review queue (human-in-the-loop, §4.2/§4.4).

AI-extracted entities/relations land as PENDING; investigators confirm/reject;
high-impact merge approvals are SHO-only (§4.1). Every confirm/reject
best-effort enqueues a graph rebuild so Neo4j tracks the reviewed state —
a down broker never breaks the review API itself.
"""
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_contribute_case, user_can_edit_case, user_can_view_case

from .models import ExtractedEntity, ExtractedRelation, MergeStatus, MergeSuggestion, ReviewStatus
from .serializers import (
    ExtractedEntitySerializer,
    ExtractedRelationSerializer,
    MergeSuggestionSerializer,
)


def _case_or_403(request, case_id):
    case = get_object_or_404(Case, pk=case_id)
    if not user_can_view_case(request.user, case):
        return None, Response({"detail": "Forbidden."}, status=403)
    return case, None


def _kick_rebuild(case_id: int) -> None:
    try:
        from .tasks import build_temporal_graph
        build_temporal_graph.delay(case_id)
    except Exception:
        pass  # broker down: rebuild happens on next confirm or manual /build/


def _page(qs, request, serializer_cls, default_limit=100, max_limit=500):
    """?limit=&offset= pagination returning {count, results}."""
    try:
        limit = int(request.query_params.get("limit", default_limit))
    except (TypeError, ValueError):
        limit = default_limit
    try:
        offset = int(request.query_params.get("offset", 0))
    except (TypeError, ValueError):
        offset = 0
    limit = max(1, min(limit, max_limit))
    offset = max(0, offset)
    total = qs.count()
    page = qs[offset:offset + limit]
    return Response({"count": total, "results": serializer_cls(page, many=True).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def review_entities(request):
    case, err = _case_or_403(request, request.query_params.get("case_id"))
    if err:
        return err
    qs = ExtractedEntity.objects.filter(case=case).select_related("evidence", "case").order_by("id")
    status_ = request.query_params.get("status")
    if status_:
        qs = qs.filter(status=status_)
    return _page(qs, request, ExtractedEntitySerializer)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def review_entity_decide(request, pk):
    ent = get_object_or_404(ExtractedEntity, pk=pk)
    if not user_can_contribute_case(request.user, ent.case):
        return Response({"detail": "Only investigators assigned to this case can verify entities."}, status=403)
    decision = (request.data.get("decision") or request.query_params.get("decision") or "").lower()
    if decision not in ("confirm", "reject"):
        return Response({"detail": "decision must be confirm|reject"}, status=400)
    return _decide_entity(ent, decision)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def review_relations(request):
    case, err = _case_or_403(request, request.query_params.get("case_id"))
    if err:
        return err
    qs = (ExtractedRelation.objects.filter(case=case)
          .select_related("src", "dst", "evidence").order_by("id"))
    status_ = request.query_params.get("status")
    if status_:
        qs = qs.filter(status=status_)
    return _page(qs, request, ExtractedRelationSerializer)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def review_relation_decide(request, pk):
    rel = get_object_or_404(ExtractedRelation, pk=pk)
    if not user_can_contribute_case(request.user, rel.case):
        return Response({"detail": "Only investigators assigned to this case can verify relations."}, status=403)
    decision = (request.data.get("decision") or "").lower()
    if decision not in ("confirm", "reject"):
        return Response({"detail": "decision must be confirm|reject"}, status=400)
    rel.status = ReviewStatus.CONFIRMED if decision == "confirm" else ReviewStatus.REJECTED
    rel.save(update_fields=["status"])
    if decision == "confirm" and rel.confidence >= 0.6:
        # High-confidence connection found -> realtime alert (deduplicated).
        try:
            from apps.alerts.services import emit_event
            emit_event(
                "connection", rel.case,
                f"High-confidence link confirmed: '{rel.src.value}' —[{rel.edge_type}]→ '{rel.dst.value}' "
                f"({rel.confidence:.0%})",
                severity="high" if rel.confidence >= 0.8 else "medium",
                refs={"relation_id": rel.id, "entity_keys": [rel.src.graph_key or rel.src.normalized,
                                                             rel.dst.graph_key or rel.dst.normalized],
                      "evidence_id": rel.evidence_id},
                confidence=rel.confidence,
                dedupe_key=f"rel-{rel.id}")
        except Exception:
            pass
    _kick_rebuild(rel.case_id)
    return Response(ExtractedRelationSerializer(rel).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def merge_list(request):
    case, err = _case_or_403(request, request.query_params.get("case_id"))
    if err:
        return err
    qs = MergeSuggestion.objects.filter(case=case).select_related("entity_a", "entity_b").order_by("id")
    status_ = request.query_params.get("status")
    if status_:
        qs = qs.filter(status=status_)
    return _page(qs, request, MergeSuggestionSerializer)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def review_queue(request):
    """Cross-case pending queue, scoped to visible cases.

    Returns {"entities": {count, results}, "relations": {...}, "merges": {...}}.
    Serializers already carry case/case_fir for scoping display.
    """
    from apps.cases.permissions import visible_case_ids

    ids = visible_case_ids(request.user)
    status_ = request.query_params.get("status", "pending")
    ent = ExtractedEntity.objects.select_related("evidence", "case").order_by("id")
    rel = ExtractedRelation.objects.select_related("src", "dst", "evidence").order_by("id")
    mrg = MergeSuggestion.objects.select_related("entity_a", "entity_b").order_by("id")
    if ids is not None:
        ent = ent.filter(case_id__in=ids)
        rel = rel.filter(case_id__in=ids)
        mrg = mrg.filter(case_id__in=ids)
    if status_:
        ent = ent.filter(status=status_)
        rel = rel.filter(status=status_)
        mrg = mrg.filter(status=status_)
    try:
        limit = max(1, min(int(request.query_params.get("limit", 50)), 200))
    except (TypeError, ValueError):
        limit = 50
    return Response({
        "entities": {"count": ent.count(),
                     "results": ExtractedEntitySerializer(ent[:limit], many=True).data},
        "relations": {"count": rel.count(),
                      "results": ExtractedRelationSerializer(rel[:limit], many=True).data},
        "merges": {"count": mrg.count(),
                   "results": MergeSuggestionSerializer(mrg[:limit], many=True).data},
    })


def _decide_entity(ent, decision):
    ent.status = ReviewStatus.CONFIRMED if decision == "confirm" else ReviewStatus.REJECTED
    ent.save(update_fields=["status", "updated_at"])
    _kick_rebuild(ent.case_id)
    return Response(ExtractedEntitySerializer(ent).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def case_entity_confirm(request, case_pk, eid):
    """Nested spec route: confirm one case entity. SHO gets 403."""
    case = get_object_or_404(Case, pk=case_pk)
    ent = get_object_or_404(ExtractedEntity, pk=eid, case=case)
    if not user_can_view_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    if not user_can_contribute_case(request.user, case):
        return Response({"detail": "Only investigators assigned to this case can verify entities."}, status=403)
    return _decide_entity(ent, "confirm")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def case_entity_reject(request, case_pk, eid):
    """Nested spec route: reject one case entity. SHO gets 403."""
    case = get_object_or_404(Case, pk=case_pk)
    ent = get_object_or_404(ExtractedEntity, pk=eid, case=case)
    if not user_can_view_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    if not user_can_contribute_case(request.user, case):
        return Response({"detail": "Only investigators assigned to this case can verify entities."}, status=403)
    return _decide_entity(ent, "reject")


def _pick_survivor(a: ExtractedEntity, b: ExtractedEntity) -> tuple[ExtractedEntity, ExtractedEntity]:
    key = lambda e: (e.mention_count, e.confidence, -e.id)
    return (a, b) if key(a) >= key(b) else (b, a)


def _repoint_or_fold(case_id: int, survivor: ExtractedEntity, dup: ExtractedEntity) -> None:
    """Repoint dup's relations onto survivor; fold on unique-conflict."""
    for rel in ExtractedRelation.objects.filter(case_id=case_id).filter(Q(src=dup) | Q(dst=dup)):
        changed = False
        if rel.src_id == dup.id:
            rel.src = survivor
            changed = True
        if rel.dst_id == dup.id:
            rel.dst = survivor
            changed = True
        if rel.src_id == rel.dst_id:
            rel.delete()  # self-loop after merge: drop
            continue
        if changed:
            try:
                with transaction.atomic():
                    rel.save(update_fields=["src", "dst"])
            except IntegrityError:
                # A survivor-equivalent edge exists: keep the stronger one.
                other = ExtractedRelation.objects.get(
                    case_id=case_id, src=rel.src, dst=rel.dst, edge_type=rel.edge_type)
                if rel.confidence > other.confidence:
                    other.confidence = rel.confidence
                    other.snippet = rel.snippet or other.snippet
                    other.save(update_fields=["confidence", "snippet"])
                rel.delete()


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def merge_decide(request, pk):
    ms = get_object_or_404(MergeSuggestion.objects.select_related("entity_a", "entity_b"), pk=pk)
    if not user_can_edit_case(request.user, ms.case):
        return Response({"detail": "Forbidden."}, status=403)
    decision = (request.data.get("decision") or "").lower()
    if decision not in ("approve", "reject"):
        return Response({"detail": "decision must be approve|reject"}, status=400)
    if decision == "approve" and not request.user.is_sho():
        # High-impact AI suggestions (entity merges) need SHO approval (§4.1).
        return Response({"detail": "Only SHO/Admin can approve merges."}, status=403)
    if ms.status != MergeStatus.PENDING:
        return Response({"detail": f"Already {ms.status}."}, status=409)
    if decision == "reject":
        ms.status = MergeStatus.REJECTED
        ms.decided_by = request.user
        ms.decided_at = timezone.now()
        ms.save(update_fields=["status", "decided_by", "decided_at"])
        return Response(MergeSuggestionSerializer(ms).data)

    a, b = ms.entity_a, ms.entity_b
    survivor, dup = _pick_survivor(a, b)
    _repoint_or_fold(ms.case_id, survivor, dup)
    dup.status = ReviewStatus.MERGED
    dup.merged_into = survivor
    dup.save(update_fields=["status", "merged_into", "updated_at"])
    survivor.mention_count += dup.mention_count
    survivor.save(update_fields=["mention_count", "updated_at"])
    # Best-effort Neo4j merge (both may already have graph keys from a build).
    try:
        from apps.graph_api.services.graph_service import GraphService, node_key
        if survivor.graph_key and dup.graph_key:
            GraphService().merge_nodes(survivor.graph_key, dup.graph_key, {
                "node_type": survivor.node_type, "value": survivor.value,
                "normalized": survivor.normalized, "confidence_score": survivor.confidence,
                "source_evidence_id": survivor.evidence_id})
        elif survivor.graph_key and not dup.graph_key:
            dup.graph_key = survivor.graph_key  # dup never built; alias to survivor
            dup.save(update_fields=["graph_key", "updated_at"])
        else:
            dup.graph_key = node_key(ms.case_id, survivor.node_type, survivor.normalized)
            dup.save(update_fields=["graph_key", "updated_at"])
    except Exception:
        pass
    ms.status = MergeStatus.APPROVED
    ms.decided_by = request.user
    ms.decided_at = timezone.now()
    ms.save(update_fields=["status", "decided_by", "decided_at"])
    _kick_rebuild(ms.case_id)
    return Response(MergeSuggestionSerializer(ms).data)
