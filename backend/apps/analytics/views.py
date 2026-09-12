"""Analytics layer API (Phase 5): GDS workup, risk, anomalies, cross-case, compare.

All endpoints enforce case-level RBAC; cross-case discovery additionally
restricts to mutually-visible cases (hidden cases never leak, §4.4).
"""
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.cases.models import Case
from apps.cases.permissions import user_can_view_case, visible_case_ids
from apps.graph_api.services.graph_service import GraphService, GraphUnavailable

from .models import RiskReport
from .serializers import RiskReportSerializer


def _case_or_403(request, case_id):
    case = get_object_or_404(Case, pk=case_id)
    if not user_can_view_case(request.user, case):
        return None, Response({"detail": "Forbidden."}, status=403)
    return case, None


def _metrics_or_503(case_id):
    from .services import gds as gds_svc
    try:
        return gds_svc.case_metrics(case_id), None
    except GraphUnavailable as exc:
        return None, Response({"detail": str(exc)[:200]}, status=503)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard(request):
    """Aggregated KPIs for the dashboard, scoped to visible cases.

    The frontend must not sum arrays client-side; everything here is
    pre-aggregated. None (SHO/admin) means all cases.
    """
    from apps.evidence.models import Evidence
    from apps.graph_api.models import ExtractedEntity, ReviewStatus

    ids = visible_case_ids(request.user)
    cases = Case.objects.all() if ids is None else Case.objects.filter(pk__in=ids)
    evidence = Evidence.objects.all() if ids is None else Evidence.objects.filter(case_id__in=ids)
    entities = ExtractedEntity.objects.all() if ids is None else ExtractedEntity.objects.filter(case_id__in=ids)
    return Response({
        "cases_total": cases.count(),
        "cases_open": cases.exclude(status="closed").count(),
        "evidence_files": evidence.count(),
        "evidence_in_pipeline": evidence.filter(ocr_status__in=("pending", "processing")).count(),
        "entities_extracted": entities.count(),
        "entities_pending": entities.filter(status=ReviewStatus.PENDING).count(),
        "high_risk_cases": cases.filter(risk_level="high").count(),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def case_overview(request, case_id):
    """Key players (centrality), communities, bridges — with engine provenance."""
    case, err = _case_or_403(request, case_id)
    if err:
        return err
    metrics, err = _metrics_or_503(case.id)
    if err:
        return err
    nodes = sorted(metrics["nodes"].values(),
                   key=lambda n: (-n.get("pagerank", 0.0), -n.get("degree", 0)))
    return Response({
        "case_id": case.id, "engine": metrics["engine"], "counts": metrics["counts"],
        "key_players": nodes[:15], "bridges": metrics["bridges"],
        "communities": metrics["communities"], "notes": metrics["notes"],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def case_risk(request, case_id):
    """Explainable risk scores; every computation auto-persists an audit record."""
    from .services import gds as gds_svc
    from .services import risk as risk_svc
    from .services.crosscase import cross_case_counts

    case, err = _case_or_403(request, case_id)
    if err:
        return err
    metrics, err = _metrics_or_503(case.id)
    if err:
        return err
    counts = cross_case_counts(visible_case_ids(request.user))
    # Map counts (keyed by type+normalized) onto graph keys case:type:normalized.
    by_norm = {(t, nrm): c for (t, nrm), c in counts.items()}
    per_key = {}
    for key, n in metrics["nodes"].items():
        norm = key.split(":", 2)[-1] if key.count(":") >= 2 else ""
        per_key[key] = by_norm.get((n.get("type", ""), norm), 1)
    scores = risk_svc.score_nodes(metrics["nodes"], per_key)
    report = RiskReport.objects.create(
        case=case, created_by=request.user, weights_version=risk_svc.WEIGHTS_VERSION,
        scores=scores, node_count=len(scores))
    return Response({
        "case_id": case.id, "report_id": report.id, "computed_at": report.created_at,
        "weights_version": risk_svc.WEIGHTS_VERSION, "weights": risk_svc.WEIGHTS,
        "scores": scores,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def risk_history(request, case_id):
    case, err = _case_or_403(request, case_id)
    if err:
        return err
    qs = RiskReport.objects.filter(case=case).select_related("created_by")[:20]
    return Response(RiskReportSerializer(qs, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def case_anomalies(request, case_id):
    from .services import anomalies as anom_svc
    from .services import gds as gds_svc

    case, err = _case_or_403(request, case_id)
    if err:
        return err
    metrics, err = _metrics_or_503(case.id)
    if err:
        return err
    try:
        graph = GraphService().get_case_graph(case.id, limit=5000)
    except GraphUnavailable as exc:
        return Response({"detail": str(exc)[:200]}, status=503)
    return Response({
        "case_id": case.id,
        "anomalies": anom_svc.detect(metrics["nodes"], graph["edges"], metrics["communities"]),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def cross_case(request):
    from .services.crosscase import shared_entities
    return Response({
        "results": shared_entities(visible_case_ids(request.user)),
        "scoped": visible_case_ids(request.user) is not None,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def district_list(request):
    """Distinct districts for the dashboard selector."""
    districts = (Case.objects.exclude(district="").values_list("district", flat=True)
                 .distinct().order_by("district")[:100])
    return Response({"districts": list(districts)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def district_overview(request):
    """District/state-level aggregates: caseload, risk, workload, growth."""
    from django.db.models import Count
    from django.db.models.functions import TruncWeek

    from apps.accounts.models import User
    from apps.evidence.models import Evidence
    from apps.graph_api.models import ExtractedEntity

    district = (request.query_params.get("district") or "").strip()
    if not district:
        return Response({"detail": "?district= required (see districts/)."}, status=400)
    cases = Case.objects.filter(district=district)
    by_status = {r["status"]: r["n"] for r in cases.values("status").annotate(n=Count("id"))}
    by_risk = {r["risk_level"]: r["n"] for r in cases.values("risk_level").annotate(n=Count("id"))}
    workload = []
    for u in User.objects.filter(role__in=("investigator", "sho")).order_by("username")[:50]:
        active = cases.filter(assignments__user=u).exclude(status__in=("closed", "archived")).count()
        owned = cases.filter(owner=u).exclude(status__in=("closed", "archived")).count()
        if active or owned:
            pending = ExtractedEntity.objects.filter(
                case__district=district, case__assignments__user=u, status="pending").count()
            workload.append({"username": u.username, "role": u.role,
                             "active_cases": active + owned, "pending_reviews": pending})
    growth = [{"week": r["week"].isoformat(), "evidence_added": r["n"]}
              for r in Evidence.objects.filter(case__district=district)
              .annotate(week=TruncWeek("created_at")).values("week").annotate(n=Count("id"))
              .order_by("week")[:26]]
    cross = (ExtractedEntity.objects.filter(case__district=district).exclude(status="rejected")
             .values("node_type", "normalized").annotate(cases=Count("case", distinct=True))
             .filter(cases__gte=2).order_by("-cases")[:10])
    return Response({
        "district": district,
        "cases": {"total": cases.count(), "by_status": by_status, "by_risk": by_risk},
        "workload": sorted(workload, key=lambda w: -w["active_cases"]),
        "growth": growth,
        "cross_case_top": [{"node_type": r["node_type"], "normalized": r["normalized"],
                            "cases": r["cases"]} for r in cross],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def case_compare(request, case_id):
    """Date-based 'what changed': graph ≤from vs graph ≤to (valid_from)."""
    case, err = _case_or_403(request, case_id)
    if err:
        return err
    date_from = request.query_params.get("from")
    date_to = request.query_params.get("to")
    if not date_from or not date_to:
        return Response({"detail": "?from=YYYY-MM-DD&to=YYYY-MM-DD required."}, status=400)
    try:
        svc = GraphService()
        a = svc.get_case_graph(case.id, limit=5000, date_to=date_from)
        b = svc.get_case_graph(case.id, limit=5000, date_to=date_to)
    except GraphUnavailable as exc:
        return Response({"detail": str(exc)[:200]}, status=503)
    except ValueError as exc:
        return Response({"detail": str(exc)[:200]}, status=400)
    an, bn = {n["id"]: n for n in a["nodes"]}, {n["id"]: n for n in b["nodes"]}
    ae, be = {e["id"]: e for e in a["edges"]}, {e["id"]: e for e in b["edges"]}
    return Response({
        "case_id": case.id,
        "a": {"label": f"≤ {date_from}", "node_count": len(an), "edge_count": len(ae)},
        "b": {"label": f"≤ {date_to}", "node_count": len(bn), "edge_count": len(be)},
        "nodes": {"added": [bn[k] for k in bn.keys() - an.keys()],
                  "removed": [an[k] for k in an.keys() - bn.keys()]},
        "edges": {"added": [be[k] for k in be.keys() - ae.keys()],
                  "removed": [ae[k] for k in ae.keys() - be.keys()]},
    })
