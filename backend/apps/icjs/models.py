from django.db import models


class IcjsImportLog(models.Model):
    """Audit trail for one ICJS case-bundle import into a PRAMAAN case.

    The investigator picks the target case explicitly (no auto-matching by
    external id); external_case_id is stored for traceability. Mutating
    /api/ calls are additionally logged by the audit middleware.
    """

    STATUS = (
        ("pending", "Pending"),
        ("success", "Success"),
        ("partial", "Partial"),
        ("failed", "Failed"),
    )

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="icjs_imports")
    external_case_id = models.CharField(max_length=64)
    requested_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT)
    status = models.CharField(max_length=16, choices=STATUS, default="pending")
    files_imported = models.PositiveIntegerField(default=0)
    files_failed = models.PositiveIntegerField(default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_detail = models.TextField(blank=True)

    class Meta:
        ordering = ("-started_at",)
