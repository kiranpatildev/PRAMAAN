from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogListView(generics.ListAPIView):
    """Full trail for SHO; investigators see only their own actions (read-only)."""
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = AuditLog.objects.all().order_by("-timestamp")
        if self.request.user.is_sho():
            return qs
        return qs.filter(actor=self.request.user)
