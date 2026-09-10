from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", include("apps.system.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/cases/", include("apps.cases.urls")),
    path("api/entities/", include("apps.graph_api.urls_entities")),
    path("api/analytics/", include("apps.analytics.urls")),
    path("api/copilot/", include("apps.copilot.urls")),
    path("api/search/", include("apps.search.urls")),
    path("api/alerts/", include("apps.alerts.urls")),
    path("api/reports/", include("apps.reports.urls")),
    path("api/audit/", include("apps.auditlog.urls")),
    path("api/icjs/", include("apps.icjs.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
