from django.db import models


class AlertKind(models.TextChoices):
    CONNECTION = "connection", "High-confidence connection"
    RISK = "risk", "Risk threshold crossed"
    CROSS_CASE = "cross_case", "Cross-case match"
    ANOMALY = "anomaly", "Anomaly flagged"
    SYSTEM = "system", "System"


class Severity(models.TextChoices):
    LOW = "low", "Low"
    MEDIUM = "medium", "Medium"
    HIGH = "high", "High"


SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}


class Alert(models.Model):
    """Case-level event feed (deduplicated). Personal delivery = Notification rows."""

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="alerts", null=True, blank=True)
    kind = models.CharField(max_length=64, default=AlertKind.SYSTEM)
    message = models.CharField(max_length=512)
    severity = models.CharField(max_length=16, default=Severity.LOW)
    refs = models.JSONField(default=dict, blank=True)  # {entity_keys, evidence_ids, other_cases, ...}
    dedupe_key = models.CharField(max_length=255, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)


class AlertRule(models.Model):
    """Per-user routing: which events reach me, at what threshold, via what channel."""

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="alert_rules")
    kind = models.CharField(max_length=64, default="any")  # any|connection|risk|cross_case|anomaly|system
    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, null=True, blank=True,
                             related_name="alert_rules",
                             help_text="Null = all cases I can see.")
    min_severity = models.CharField(max_length=16, choices=Severity.choices, default=Severity.LOW)
    min_confidence = models.FloatField(default=0.0)
    email_digest = models.BooleanField(default=False, help_text="Reserved: email digest is disabled (no sender).")
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def matches(self, kind: str, severity: str, confidence: float) -> bool:
        if not self.enabled:
            return False
        if self.kind != "any" and self.kind != kind:
            return False
        if SEVERITY_RANK.get(severity, 0) < SEVERITY_RANK.get(self.min_severity, 0):
            return False
        return confidence >= self.min_confidence


class Notification(models.Model):
    """Personal delivery of an Alert (in-app realtime + mocked email digests)."""

    CHANNELS = (("inapp", "In-app"), ("email_mock", "Mocked email"))

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="notifications")
    alert = models.ForeignKey(Alert, on_delete=models.CASCADE, related_name="notifications")
    channel = models.CharField(max_length=16, choices=CHANNELS, default="inapp")
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["user", "read", "-created_at"])]  # bell unread queries
