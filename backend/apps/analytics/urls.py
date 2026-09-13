from django.urls import path

from .views import (
    case_anomalies,
    case_overview,
    case_risk,
    cross_case,
    dashboard,
    district_list,
    district_overview,
    risk_history,
)

urlpatterns = [
    path("dashboard/", dashboard, name="analytics-dashboard"),
    path("case/<int:case_id>/overview/", case_overview, name="analytics-overview"),
    path("case/<int:case_id>/risk/", case_risk, name="analytics-risk"),
    path("case/<int:case_id>/risk/history/", risk_history, name="analytics-risk-history"),
    path("case/<int:case_id>/anomalies/", case_anomalies, name="analytics-anomalies"),
    path("cross-case/", cross_case, name="analytics-cross-case"),
    path("districts/", district_list, name="analytics-districts"),
    path("district/", district_overview, name="analytics-district"),
]
