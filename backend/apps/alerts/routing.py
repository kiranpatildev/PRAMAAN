from django.urls import path

from .consumers import AlertsConsumer

websocket_urlpatterns = [path("ws/alerts/", AlertsConsumer.as_asgi())]
