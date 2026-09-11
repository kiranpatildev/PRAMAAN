from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import Case, CaseAssignment


class CaseAssignmentSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = CaseAssignment
        fields = ("id", "user", "user_id", "permission", "created_at")
        read_only_fields = ("id", "created_at")


class CaseSerializer(serializers.ModelSerializer):
    assignments = CaseAssignmentSerializer(many=True, read_only=True)
    owner = UserSerializer(read_only=True)
    entities_count = serializers.IntegerField(read_only=True, default=0)
    evidence_count = serializers.IntegerField(read_only=True, default=0)
    alerts_count = serializers.IntegerField(read_only=True, default=0)
    relations_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Case
        fields = (
            "id", "fir_no", "title", "description", "status", "risk_level",
            "station", "district", "state", "owner", "assignments",
            "entities_count", "evidence_count", "alerts_count",
            "relations_count", "created_at", "updated_at",
        )
        read_only_fields = ("id", "owner", "created_at", "updated_at")
