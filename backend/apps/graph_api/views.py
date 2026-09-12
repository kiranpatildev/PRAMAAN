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
            data = GraphService().get_case_graph(case.id, **self._filters(request))
        except GraphUnavailable as exc:
            return Response({"nodes": [], "edges": [], "clusters": [], "case_id": case.id,
                             "live": False, "detail": str(exc)[:200]})
        except ValueError as exc:
            return Response({"detail": str(exc)[:200]}, status=400)
        data["clusters"] = _clusters_for(data.get("nodes", []), data.get("edges", []))
        return Response(data)

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

    def relationships(self, request, case_pk=None):
        """Relationship breakdown grouped by type: {types: [{type, count}]}."""
        from django.db.models import Count

        from .models import ExtractedRelation, ReviewStatus

        case, err = self._case_or_403(request, case_pk)
        if err:
            return err
        rows = (
            ExtractedRelation.objects.filter(case=case)
            .exclude(status=ReviewStatus.REJECTED)
            .values("edge_type")
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        return Response({"types": [{"type": r["edge_type"], "count": r["count"]} for r in rows]})

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


_DOMAIN_FOR_EDGE = {
    "CALLED": "COMMUNICATIONS",
    "CONTACTED": "COMMUNICATIONS",
    "MESSAGED": "COMMUNICATIONS",
    "USES": "COMMUNICATIONS",
    "PAID": "FINANCIAL",
    "TRANSFERRED_TO": "FINANCIAL",
    "OWNS": "FINANCIAL",
    "PRESENT_AT": "LOGISTICS",
    "VISITED": "LOGISTICS",
    "TRAVELLED_WITH": "LOGISTICS",
    "ASSOCIATED_WITH": "ASSOCIATES",
    "MENTIONED_IN": "DOCUMENTS",
}


def _clusters_for(nodes, edges):
    """Deterministic cluster assignment (A/B/C/D…) over the returned view.

    Groups of 4–6 connected nodes; each cluster gets a domain label from
    its dominant edge type. Nodes carry `cluster` + `cluster_label` so the
    frontend never reconstructs grouping itself.
    """
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    ids = [n.get("id") for n in nodes if n.get("id")]
    for e in edges:
        s, t = e.get("source"), e.get("target")
        if s and t:
            parent.setdefault(s, s)
            parent.setdefault(t, t)
            union(s, t)
    for i in ids:
        parent.setdefault(i, i)
    groups: dict[str, list[str]] = {}
    for i in ids:
        groups.setdefault(find(i), []).append(i)
    ordered = sorted(groups.values(), key=len, reverse=True)

    letters = "ABCD"
    clusters = []
    node_cluster: dict[str, dict] = {}
    idx = 0
    # Pack large components into 4–6 node chunks so halos stay readable.
    chunks: list[list[str]] = []
    for g in ordered:
        rest = sorted(g)
        while len(rest) > 6:
            chunks.append(rest[:5])
            rest = rest[5:]
        if rest:
            chunks.append(rest)
    # Largest chunks earn lettered labels; leftovers fold into the last one.
    named = chunks[:4]
    leftover = [m for ch in chunks[4:] for m in ch]
    if leftover and named:
        named[-1] = named[-1] + leftover
    elif leftover:
        named = [leftover]
    for ch in named:
        letter = letters[idx] if idx < len(letters) else str(idx + 1)
        types: dict[str, int] = {}
        chset = set(ch)
        for m in ch:
            for e in edges:
                if e.get("source") == m and e.get("target") in chset:
                    types[e.get("label", "")] = types.get(e.get("label", ""), 0) + 1
        top = max(types, key=types.get) if types else ""
        domain = _DOMAIN_FOR_EDGE.get((top or "").upper(), "GENERAL")
        label = f"CLUSTER {letter} — {domain}"
        clusters.append({"id": letter, "label": label, "members": sorted(ch)})
        for m in ch:
            node_cluster[m] = {"cluster": letter, "cluster_label": label}
        idx += 1
    for n in nodes:
        info = node_cluster.get(n.get("id", ""), {})
        n["cluster"] = info.get("cluster")
        n["cluster_label"] = info.get("cluster_label")
    return clusters
