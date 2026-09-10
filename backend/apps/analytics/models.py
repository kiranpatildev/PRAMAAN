from django.db import models


class RiskReport(models.Model):
    """Persisted risk assessment: reproducible + auditable (§4.4, §5).

    `scores` holds the full factor breakdown per node, so any past score can
    be explained long after the graph moved on. `weights_version` pins the
    formula that produced it.
    """

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="risk_reports")
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    weights_version = models.CharField(max_length=16, default="v1")
    scores = models.JSONField(default=list, blank=True)  # [{key,label,type,score,level,factors}]
    node_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
