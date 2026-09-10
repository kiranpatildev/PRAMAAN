"""Best-effort audit middleware: logs mutating API calls. Read-only /api/audit/ excluded."""
from apps.auditlog.models import AuditLog


class AuditLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        try:
            if request.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
                if request.path.startswith("/api/audit"):
                    return response
                actor = request.user if getattr(request, "user", None) and request.user.is_authenticated else None
                AuditLog.objects.create(
                    actor=actor,
                    action={"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}[request.method],
                    object_type=request.path,
                    object_id="",
                    after={"status": response.status_code},
                    ip=request.META.get("REMOTE_ADDR"),
                )
        except Exception:
            pass
        return response
