from rest_framework import serializers

from .models import ChainOfCustody, Evidence


class EvidenceSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = Evidence
        fields = (
            "id", "case", "file_name", "file_type", "mime_type", "size_bytes",
            "sha256", "storage_key", "uploaded_by", "classification",
            "classification_confidence", "ocr_status", "ocr_pages", "ocr_engine",
            "processing_error", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "sha256", "storage_key", "uploaded_by", "classification",
            "classification_confidence", "ocr_status", "ocr_pages", "ocr_engine",
            "processing_error", "created_at", "updated_at",
        )


class ChainOfCustodySerializer(serializers.ModelSerializer):
    actor = serializers.StringRelatedField()

    class Meta:
        model = ChainOfCustody
        fields = ("id", "action", "actor", "details", "evidence_snapshot", "ip", "timestamp")
