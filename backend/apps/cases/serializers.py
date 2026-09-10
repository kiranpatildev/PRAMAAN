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

    class Meta:
        model = Case
        fields = (
            "id", "fir_no", "title", "description", "status", "risk_level",
            "station", "district", "owner", "assignments", "created_at", "updated_at",
        )
        read_only_fields = ("id", "owner", "created_at", "updated_at")
