from django.db import models


class Report(models.Model):
    """Generated artifact (court-ready evidence package) stored in MinIO."""

    KIND = (("evidence_package", "Evidence package"),)

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="reports")
    kind = models.CharField(max_length=32, choices=KIND, default="evidence_package")
    storage_key = models.CharField(max_length=512, blank=True, default="")
    sha256 = models.CharField(max_length=64, blank=True, default="")
    size_bytes = models.BigIntegerField(default=0)
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
