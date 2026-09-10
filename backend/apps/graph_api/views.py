from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.cases.models import Case
from apps.cases.permissions import user_can_edit_case, user_can_view_case

from .services.graph_service import GraphService, GraphUnavailable


class GraphViewSet(ViewSet):
    """Case-scoped graph reads (live Neo4j) + build trigger. Heavy GDS analytics: Phase 5."""

    def _case_or_403(self, request, case_pk):
        try:
            case = Case.objects.get(pk=case_pk)
        except Case.DoesNotExist:
            return None, Response({"detail": "Case not found."}, status=404)
        if not user_can_view_case(request.user, case):
            return None, Response({"detail": "Forbidden."}, status=403)
        return case, None

    def _filters(self, request) -> dict:
        types = request.query_params.get("types") or request.query_params.get("node_types")
        node_types = [t.strip() for t in types.split(",") if t.strip()] or None if types else None
        try:
            minconf = float(request.query_params.get("min_confidence", 0.0) or 0.0)
        except (TypeError, ValueError):
            minconf = 0.0
        return {
            "node_types": node_types,
            "min_confidence": min(1.0, max(0.0, minconf)),
            "date_from": request.query_params.get("date_from") or None,
            "date_to": request.query_params.get("date_to") or None,
        }

    def retrieve(self, request, case_pk=None):
        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        try:
            return Response(GraphService().get_case_graph(case.id, **self._filters(request)))
        except GraphUnavailable as exc:
            return Response({"nodes": [], "edges": [], "case_id": case.id,
                             "live": False, "detail": str(exc)[:200]})
        except ValueError as exc:
            return Response({"detail": str(exc)[:200]}, status=400)

    def expand(self, request, case_pk=None):
        """Neighborhood of one node (2nd/3rd-degree via ?depth=)."""
        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        node = request.query_params.get("node")
        if not node:
            return Response({"detail": "node query param is required."}, status=400)
        try:
            depth = int(request.query_params.get("depth", 1))
        except (TypeError, ValueError):
            depth = 1
        try:
            return Response(GraphService().expand_node(case.id, node, depth))
        except GraphUnavailable as exc:
            return Response({"detail": str(exc)[:200]}, status=503)

    def timeline(self, request, case_pk=None):
        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        try:
            return Response(GraphService().timeline(case.id))
        except GraphUnavailable as exc:
            return Response({"case_id": case.id, "events": [], "live": False,
                             "detail": str(exc)[:200]})

    def build(self, request, case_pk=None):
        """Enqueue a rebuild of the case graph from confirmed review rows."""
        from .tasks import build_temporal_graph

        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        if not user_can_edit_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        try:
            build_temporal_graph.delay(case.id)
            return Response({"case_id": case.id, "build": "queued"})
        except Exception as exc:
            return Response({"detail": f"Broker unavailable: {exc}"[:200]}, status=503)

    def snapshot(self, request, case_pk=None):
        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        return Response(GraphService().snapshot(case.id, request.data.get("label", "")))

    def diff(self, request, case_pk=None):
        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        return Response(GraphService().diff(case.id, request.query_params.get("from", ""), request.query_params.get("to", "")))

    def what_if(self, request, case_pk=None):
        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        return Response(GraphService().what_if(case.id, request.data.get("remove_nodes", [])))

    def timeline(self, request, case_pk=None):
        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        return Response(GraphService().timeline(case.id))
