from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.evidence.views import EvidenceViewSet
from apps.graph_api.views import GraphViewSet
from apps.graph_api.views_geo import entity_locate, geo_movements, geo_nearby, geo_points
from apps.graph_api.views_snapshots import snapshot_detail, snapshot_diff, snapshot_list_create
from apps.icjs.views import import_case as icjs_import_case

from .views import CaseViewSet
from .views_workflow import (
    activity_feed,
    comment_delete,
    comment_list_create,
    link_delete,
    link_list_create,
    task_detail,
    task_list_create,
)

router = DefaultRouter()
router.register(r"", CaseViewSet, basename="case")

# Nested case-scoped routes: /api/cases/{id}/evidence/ and /api/cases/{id}/graph/
evidence_list = EvidenceViewSet.as_view({"get": "list", "post": "create"})
evidence_detail = EvidenceViewSet.as_view({"get": "retrieve", "delete": "destroy"})
evidence_custody = EvidenceViewSet.as_view({"get": "custody"})
evidence_download = EvidenceViewSet.as_view({"get": "download"})
evidence_reprocess = EvidenceViewSet.as_view({"post": "reprocess"})
graph_detail = GraphViewSet.as_view({"get": "retrieve"})
graph_expand = GraphViewSet.as_view({"get": "expand"})
graph_build = GraphViewSet.as_view({"post": "build"})
graph_timeline = GraphViewSet.as_view({"get": "timeline"})

urlpatterns = [
    path("<int:case_pk>/evidence/", evidence_list, name="case-evidence"),
    path("<int:case_pk>/evidence/<int:pk>/", evidence_detail, name="case-evidence-detail"),
    path("<int:case_pk>/evidence/<int:pk>/custody/", evidence_custody, name="case-evidence-custody"),
    path("<int:case_pk>/evidence/<int:pk>/download/", evidence_download, name="case-evidence-download"),
    path("<int:case_pk>/evidence/<int:pk>/reprocess/", evidence_reprocess, name="case-evidence-reprocess"),
    path("<int:case_pk>/graph/", graph_detail, name="case-graph"),
    path("<int:case_pk>/graph/expand/", graph_expand, name="case-graph-expand"),
    path("<int:case_pk>/graph/build/", graph_build, name="case-graph-build"),
    path("<int:case_pk>/graph/snapshots/", snapshot_list_create, name="case-snapshots"),
    path("<int:case_pk>/graph/snapshots/diff/", snapshot_diff, name="case-snapshots-diff"),
    path("<int:case_pk>/graph/snapshots/<int:pk>/", snapshot_detail, name="case-snapshot-detail"),
    path("<int:case_pk>/timeline/", graph_timeline, name="case-timeline"),
    path("<int:case_pk>/geo/", geo_points, name="case-geo"),
    path("<int:case_pk>/geo/movements/", geo_movements, name="case-geo-movements"),
    path("<int:case_pk>/geo/nearby/", geo_nearby, name="case-geo-nearby"),
    path("<int:case_pk>/tasks/", task_list_create, name="case-tasks"),
    path("<int:case_pk>/tasks/<int:pk>/", task_detail, name="case-task-detail"),
    path("<int:case_pk>/comments/", comment_list_create, name="case-comments"),
    path("<int:case_pk>/comments/<int:pk>/", comment_delete, name="case-comment-delete"),
    path("<int:case_pk>/links/", link_list_create, name="case-links"),
    path("<int:case_pk>/links/<int:pk>/", link_delete, name="case-link-delete"),
    path("<int:case_pk>/activity/", activity_feed, name="case-activity"),
    path("<int:case_pk>/icjs-import/", icjs_import_case, name="case-icjs-import"),
    path("", include(router.urls)),
]
