"""RBAC enforced at API layer (§5): SHO sees all; investigators see owned/assigned."""
from rest_framework import permissions


class IsSHO(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_sho())


def user_can_view_case(user, case) -> bool:
    if user.is_sho():
        return True
    if case.owner_id == user.id:
        return True
    return case.assignments.filter(user=user).exists()


def user_can_edit_case(user, case) -> bool:
    if user.is_sho():
        return True
    if case.owner_id == user.id:
        return True
    return case.assignments.filter(user=user, permission__in=("edit", "admin")).exists()


def visible_case_ids(user) -> list[int] | None:
    """Case ids the user may see; None means all (SHO/admin)."""
    if user.is_sho():
        return None
    from .models import Case
    owned = set(Case.objects.filter(owner=user).values_list("id", flat=True))
    assigned = set(Case.objects.filter(assignments__user=user).values_list("id", flat=True))
    return list(owned | assigned)
