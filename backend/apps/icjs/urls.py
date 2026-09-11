from django.urls import path

from .views import available_cases, import_case

urlpatterns = [
    path("icjs/available-cases/", available_cases, name="icjs-available-cases"),
    path("cases/icjs-import/", import_case, name="icjs-import-case"),
]
