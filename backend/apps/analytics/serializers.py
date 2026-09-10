from rest_framework import serializers

from .models import RiskReport


class RiskReportSerializer(serializers.ModelSerializer):
    created_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = RiskReport
        fields = ("id", "case", "created_by", "weights_version", "scores",
                  "node_count", "created_at")
