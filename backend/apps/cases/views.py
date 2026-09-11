from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.models import User

from .models import Case, CaseAssignment
from .permissions import IsSHO, user_can_edit_case, user_can_view_case
from .serializers import CaseAssignmentSerializer, CaseSerializer


class CaseViewSet(viewsets.ModelViewSet):
    serializer_class = CaseSerializer
    filterset_fields = ("status", "risk_level", "district", "station")
    search_fields = ("fir_no", "title", "description")

    def get_queryset(self):
        from django.db.models import Count
        user = self.request.user
        qs = Case.objects.prefetch_related("assignments__user", "owner").annotate(
            entities_count=Count("extracted_entities", distinct=True),
            evidence_count=Count("evidence", distinct=True),
            alerts_count=Count("alerts", distinct=True),
            relations_count=Count("extracted_relations", distinct=True),
        ).all()
        if user.is_sho():
            return qs
        return _visible_to(user, qs)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def create(self, request, *args, **kwargs):
        # Case creation is an SHO action; investigators work assigned cases.
        if not request.user.is_sho():
            return Response({"detail": "Only SHO/Admin can create cases."}, status=403)
        return super().create(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        case = self.get_object()
        if not user_can_view_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        return super().retrieve(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        case = self.get_object()
        if not user_can_edit_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        case = self.get_object()
        if not user_can_edit_case(request.user, case):
            return Response({"detail": "Forbidden."}, status=403)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_sho():
            return Response({"detail": "Only SHO/Admin can delete cases."}, status=403)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[IsSHO])
    def assign(self, request, pk=None):
        case = self.get_object()
        user = get_object_or_404(User, pk=request.data.get("user_id"))
        permission = request.data.get("permission", "edit")
        obj, _ = CaseAssignment.objects.update_or_create(
            case=case, user=user,
            defaults={"permission": permission, "assigned_by": request.user},
        )
        return Response(CaseAssignmentSerializer(obj).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Case closure workflow stub (Phase 7 adds archival + approval chain)."""
        case = self.get_object()
        if not request.user.is_sho():
            return Response({"detail": "Only SHO/Admin can close cases."}, status=403)
        case.status = "closed"
        case.save(update_fields=["status", "updated_at"])
        return Response(CaseSerializer(case).data)


def _visible_to(user, qs):
    from django.db.models import Q
    return qs.filter(Q(owner=user) | Q(assignments__user=user)).distinct()
