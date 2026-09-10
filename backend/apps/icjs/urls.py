from django.urls import path

from .views import available_cases

urlpatterns = [
    path("available-cases/", available_cases, name="icjs-available-cases"),
]
