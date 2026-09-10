from django.db import models

from apps.accounts.models import User


class CaseStatus(models.TextChoices):
    OPEN = "open", "Open"
    UNDER_INVESTIGATION = "under_investigation", "Under investigation"
    PENDING_REVIEW = "pending_review", "Pending review"
    CLOSED = "closed", "Closed"
    ARCHIVED = "archived", "Archived"


class PermissionLevel(models.TextChoices):
    VIEW = "view", "View-only"
    EDIT = "edit", "Edit"
    ADMIN = "admin", "Admin"


class Case(models.Model):
    fir_no = models.CharField(max_length=64, unique=True, db_index=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=32, choices=CaseStatus.choices, default=CaseStatus.OPEN)
    risk_level = models.CharField(max_length=16, default="low")  # low|medium|high — Phase 5 computes
    station = models.CharField(max_length=128, blank=True, default="")
    district = models.CharField(max_length=128, blank=True, default="")
    owner = models.ForeignKey(User, on_delete=models.PROTECT, related_name="owned_cases")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.fir_no} — {self.title}"


class CaseAssignment(models.Model):
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="assignments")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="case_assignments")
    permission = models.CharField(max_length=16, choices=PermissionLevel.choices, default=PermissionLevel.EDIT)
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="granted_assignments")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("case", "user")


# Workflow models live in models_workflow.py (imported here so Django registers them).
from .models_workflow import CaseComment, CaseLink, CaseTask, TaskStatus  # noqa: E402,F401
