from django.urls import path

from .views import case_package, report_download, report_list

urlpatterns = [
    path("", report_list, name="report-list"),
    path("case-package/", case_package, name="report-case-package"),
    path("<int:pk>/download/", report_download, name="report-download"),
]
