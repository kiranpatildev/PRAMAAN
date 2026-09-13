from rest_framework import serializers

from .models import ExtractedEntity, ExtractedRelation, GraphSnapshot, MergeSuggestion


class ExtractedEntitySerializer(serializers.ModelSerializer):
    evidence_file = serializers.CharField(source="evidence.file_name", read_only=True, default="")
    case_fir = serializers.CharField(source="case.fir_no", read_only=True)
    # Denormalized read of the evidence's persisted detection (evidence may be
    # null after deletes; default "" keeps the contract total).
    detected_language = serializers.CharField(source="evidence.detected_language",
                                              read_only=True, default="")

    class Meta:
        model = ExtractedEntity
        fields = ("id", "case", "case_fir", "evidence", "evidence_file", "node_type",
                  "value", "normalized", "confidence", "engine", "status",
                  "native_snippet", "detected_language",
                  "mention_count", "merged_into", "graph_key", "updated_at")
        read_only_fields = fields


class ExtractedRelationSerializer(serializers.ModelSerializer):
    src_value = serializers.CharField(source="src.value", read_only=True)
    dst_value = serializers.CharField(source="dst.value", read_only=True)
    src_type = serializers.CharField(source="src.node_type", read_only=True)
    dst_type = serializers.CharField(source="dst.node_type", read_only=True)
    evidence_file = serializers.CharField(source="evidence.file_name", read_only=True, default="")

    class Meta:
        model = ExtractedRelation
        fields = ("id", "case", "evidence", "evidence_file", "src", "dst",
                  "src_value", "src_type", "dst_value", "dst_type",
                  "edge_type", "confidence", "snippet", "engine", "status")
        read_only_fields = fields


class MergeSuggestionSerializer(serializers.ModelSerializer):
    a_value = serializers.CharField(source="entity_a.value", read_only=True)
    b_value = serializers.CharField(source="entity_b.value", read_only=True)
    node_type = serializers.CharField(source="entity_a.node_type", read_only=True)
    decided_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = MergeSuggestion
        fields = ("id", "case", "entity_a", "entity_b", "a_value", "b_value",
                  "node_type", "score", "reason", "status", "decided_by", "decided_at")
        read_only_fields = fields


class GraphSnapshotSerializer(serializers.ModelSerializer):
    created_by = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = GraphSnapshot
        fields = ("id", "case", "label", "created_by", "filters",
                  "node_count", "edge_count", "created_at")
        read_only_fields = fields


class GraphSnapshotDetailSerializer(GraphSnapshotSerializer):
    class Meta(GraphSnapshotSerializer.Meta):
        fields = GraphSnapshotSerializer.Meta.fields + ("data",)
