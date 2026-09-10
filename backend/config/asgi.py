import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi = get_asgi_application()

from apps.alerts.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi,
    "websocket": URLRouter(websocket_urlpatterns),
})
# Phase 7: daphne serves this (see docker-compose backend command). The
# runserver path stays HTTP-only — use daphne locally for WS dev.
