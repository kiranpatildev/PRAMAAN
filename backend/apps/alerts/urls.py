from django.urls import include, path
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.routers import DefaultRouter

from .models import Notification
from .views import AlertRuleViewSet, NotificationListView, ScopedAlertListView

router = DefaultRouter()
router.register(r"rules", AlertRuleViewSet, basename="alert-rule")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_read(request, pk):
    try:
        note = Notification.objects.get(pk=pk, user=request.user)
    except Notification.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)
    note.read = True
    note.save(update_fields=["read"])
    return Response({"id": note.id, "read": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_all_read(request):
    n = Notification.objects.filter(user=request.user, read=False).update(read=True)
    return Response({"marked": n})


urlpatterns = [
    path("", ScopedAlertListView.as_view(), name="alert-list"),
    path("notifications/", NotificationListView.as_view(), name="notification-list"),
    path("notifications/<int:pk>/read/", mark_read, name="notification-read"),
    path("notifications/read-all/", mark_all_read, name="notification-read-all"),
    path("", include(router.urls)),
]
