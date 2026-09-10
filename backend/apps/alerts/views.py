from rest_framework import generics, serializers, viewsets

from apps.cases.permissions import visible_case_ids

from .models import Alert, AlertRule, Notification


class AlertSerializer(serializers.ModelSerializer):
    case_fir = serializers.CharField(source="case.fir_no", read_only=True, default="")

    class Meta:
        model = Alert
        fields = ("id", "case", "case_fir", "kind", "message", "severity", "refs", "created_at")


class NotificationSerializer(serializers.ModelSerializer):
    alert = AlertSerializer(read_only=True)

    class Meta:
        model = Notification
        fields = ("id", "alert", "channel", "read", "created_at")


class AlertRuleSerializer(serializers.ModelSerializer):
    case_fir = serializers.CharField(source="case.fir_no", read_only=True, default=None)

    class Meta:
        model = AlertRule
        fields = ("id", "kind", "case", "case_fir", "min_severity", "min_confidence",
                  "email_digest", "enabled", "created_at")
        read_only_fields = ("id", "created_at")


class ScopedAlertListView(generics.ListAPIView):
    """Case alert feed, strictly limited to visible cases (kind/severity filters)."""

    serializer_class = AlertSerializer

    def get_queryset(self):
        allowed = visible_case_ids(self.request.user)
        qs = Alert.objects.select_related("case").all()
        if allowed is not None:
            qs = qs.filter(case_id__in=allowed)
        kind = self.request.query_params.get("kind")
        if kind:
            qs = qs.filter(kind=kind)
        severity = self.request.query_params.get("severity")
        if severity:
            qs = qs.filter(severity=severity)
        return qs[:100]


class NotificationListView(generics.ListAPIView):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user).select_related("alert", "alert__case")
        if self.request.query_params.get("unread") == "1":
            qs = qs.filter(read=False)
        channel = self.request.query_params.get("channel")
        if channel:
            qs = qs.filter(channel=channel)
        return qs[:100]


class AlertRuleViewSet(viewsets.ModelViewSet):
    serializer_class = AlertRuleSerializer

    def get_queryset(self):
        return AlertRule.objects.filter(user=self.request.user).select_related("case")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
