"""Ops health (Phase 8): dependency checks with latency. Unauthenticated by
design (no sensitive data) — for load-balancer/demo monitoring."""
import time

from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


def _timed(fn):
    start = time.perf_counter()
    try:
        detail = fn()
        return {"ok": True, "ms": round((time.perf_counter() - start) * 1000, 1), "detail": detail}
    except Exception as exc:
        return {"ok": False, "ms": round((time.perf_counter() - start) * 1000, 1),
                "detail": str(exc)[:160]}


def _db():
    with connection.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return connection.vendor


def _redis():
    import redis
    from django.conf import settings
    client = redis.Redis.from_url(getattr(settings, "CELERY_BROKER_URL", "redis://localhost:6379/0"),
                                  socket_connect_timeout=3)
    client.ping()
    return "pong"


def _neo4j():
    from apps.graph_api.services.graph_service import GraphService
    driver = GraphService()._driver()
    try:
        with driver.session() as session:
            rec = session.run("RETURN 1 AS ok").single()
            return f"ok={rec['ok']}"
    finally:
        driver.close()


def _minio():
    from apps.evidence.services import storage
    storage.ensure_bucket()
    return storage.endpoint_url()


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    import datetime
    checks = {"db": _timed(_db), "redis": _timed(_redis),
              "neo4j": _timed(_neo4j), "minio": _timed(_minio)}
    status = 200 if all(c["ok"] for c in checks.values()) else 503
    return Response({"status": "ok" if status == 200 else "degraded",
                     "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     "checks": checks}, status=status)
