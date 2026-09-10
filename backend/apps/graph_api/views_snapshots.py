"""Saved graph views + time comparison (§4.3).

Snapshots freeze the live graph (with the filters used) into Postgres so
reports embed an immutable view and investigators can diff two points in time.
"""
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_edit_case, user_can_view_case

from .models import GraphSnapshot
from .serializers import GraphSnapshotDetailSerializer, GraphSnapshotSerializer
from .services.graph_service import GraphService, GraphUnavailable


def _parse_filters(data) -> dict:
    types = data.get("node_types")
    if isinstance(types, str):
        types = [t.strip() for t in types.split(",") if t.strip()]
    try:
        minconf = float(data.get("min_confidence", 0.0) or 0.0)
    except (TypeError, ValueError):
        minconf = 0.0
    return {
        "node_types": types or None,
        "min_confidence": min(1.0, max(0.0, minconf)),
        "date_from": data.get("date_from") or None,
        "date_to": data.get("date_to") or None,
    }


def _case_or_403(request, case_id):
    case = get_object_or_404(Case, pk=case_id)
    if not user_can_view_case(request.user, case):
        return None, Response({"detail": "Forbidden."}, status=403)
    return case, None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def snapshot_list_create(request, case_pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    if request.method == "GET":
        qs = GraphSnapshot.objects.filter(case=case).select_related("created_by")
        return Response(GraphSnapshotSerializer(qs[:100], many=True).data)
    if not user_can_edit_case(request.user, case):
        return Response({"detail": "Forbidden."}, status=403)
    label = (request.data.get("label") or "").strip()
    if not label:
        return Response({"detail": "label is required."}, status=400)
    filters = _parse_filters(request.data)
    try:
        live = GraphService().get_case_graph(case.id, **filters)
    except GraphUnavailable as exc:
        return Response({"detail": str(exc)[:200]}, status=503)
    except ValueError as exc:
        return Response({"detail": str(exc)[:200]}, status=400)
    snap = GraphSnapshot.objects.create(
        case=case, label=label, created_by=request.user, filters=filters,
        data={"nodes": live["nodes"], "edges": live["edges"]},
        node_count=len(live["nodes"]), edge_count=len(live["edges"]))
    return Response(GraphSnapshotDetailSerializer(snap).data, status=201)


@api_view(["GET", "DELETE"])
@permission_classes([IsAuthenticated])
def snapshot_detail(request, case_pk, pk):
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    snap = get_object_or_404(GraphSnapshot, pk=pk, case=case)
    if request.method == "DELETE":
        if not user_can_edit_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        snap.delete()
        return Response(status=204)
    return Response(GraphSnapshotDetailSerializer(snap).data)


def _index(items, key="id"):
    return {i[key]: i for i in items}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def snapshot_diff(request, case_pk):
    """Side-by-side state comparison: added/removed nodes + edges between A and B."""
    case, err = _case_or_403(request, case_pk)
    if err:
        return err
    a = get_object_or_404(GraphSnapshot, pk=request.query_params.get("a"), case=case)
    b = get_object_or_404(GraphSnapshot, pk=request.query_params.get("b"), case=case)
    an, bn = _index(a.data.get("nodes", [])), _index(b.data.get("nodes", []))
    ae, be = _index(a.data.get("edges", [])), _index(b.data.get("edges", []))
    return Response({
        "a": {"id": a.id, "label": a.label, "created_at": a.created_at},
        "b": {"id": b.id, "label": b.label, "created_at": b.created_at},
        "nodes": {
            "added": [bn[k] for k in bn.keys() - an.keys()],
            "removed": [an[k] for k in an.keys() - bn.keys()],
        },
        "edges": {
            "added": [be[k] for k in be.keys() - ae.keys()],
            "removed": [ae[k] for k in ae.keys() - be.keys()],
        },
    })
