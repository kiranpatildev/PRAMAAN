from django.urls import path

from .views import graph_query, query

urlpatterns = [
    path("query/", query, name="copilot-query"),
    path("graph-query/", graph_query, name="copilot-graph-query"),
]
