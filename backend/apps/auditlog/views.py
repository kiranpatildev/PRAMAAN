from rest_framework import generics

from apps.cases.permissions import IsSHO

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogListView(generics.ListAPIView):
    serializer_class = AuditLogSerializer
    permission_classes = [IsSHO]
    queryset = AuditLog.objects.all().order_by("-timestamp")
