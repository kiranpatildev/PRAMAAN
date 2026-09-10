from rest_framework import serializers

from .models import Alert


class AlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = Alert
        fields = ("id", "case", "kind", "message", "severity", "is_read", "created_at")
