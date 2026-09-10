from django.db import models


class AuditLog(models.Model):
    """Immutable audit trail: every create/update/delete with actor + before/after."""

    actor = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=32)  # create|update|delete|read-sensitive
    object_type = models.CharField(max_length=128)
    object_id = models.CharField(max_length=128, blank=True, default="")
    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ("-timestamp",)
        indexes = [models.Index(fields=["-timestamp"])]
