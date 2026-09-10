from django.db import models


class ReviewStatus(models.TextChoices):
    PENDING = "pending", "Pending review"
    CONFIRMED = "confirmed", "Confirmed"
    REJECTED = "rejected", "Rejected"
    MERGED = "merged", "Merged into another entity"


class NodeType(models.TextChoices):
    PERSON = "Person", "Person"
    ORGANIZATION = "Organization", "Organization"
    LOCATION = "Location", "Location"
    VEHICLE = "Vehicle", "Vehicle"
    PHONE = "PhoneNumber", "Phone number"
    EVENT = "Event", "Event"


class ExtractedEntity(models.Model):
    """Investigator-facing entity registry: one row per (case, type, normalized).

    Postgres is the review queue + system-of-record for extraction state;
    Neo4j holds the confirmed temporal graph (`graph_key` links the two).
    """

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="extracted_entities")
    evidence = models.ForeignKey("evidence.Evidence", on_delete=models.SET_NULL, null=True, related_name="first_seen_entities")
    node_type = models.CharField(max_length=32, choices=NodeType.choices)
    value = models.CharField(max_length=512)  # display form, first-seen
    normalized = models.CharField(max_length=512, db_index=True)
    confidence = models.FloatField(default=0.0)
    engine = models.CharField(max_length=32, blank=True, default="")  # regex|spacy|transformers
    status = models.CharField(max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.PENDING)
    mention_count = models.IntegerField(default=1)
    merged_into = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="merged_from")
    graph_key = models.CharField(max_length=640, blank=True, default="")  # Neo4j node key after build
    # Geo (Phase 7): optional coordinates. Gazetteer auto-fills known places
    # (geo_source="gazetteer"); investigators correct the rest (geo_source="manual").
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    geo_source = models.CharField(max_length=16, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-confidence", "-updated_at")
        constraints = [
            models.UniqueConstraint(fields=["case", "node_type", "normalized"], name="uniq_entity_per_case"),
        ]
        indexes = [models.Index(fields=["case", "status"])]  # review queue filtering

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.node_type}:{self.value} [{self.status}]"


class ExtractedRelation(models.Model):
    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="extracted_relations")
    evidence = models.ForeignKey("evidence.Evidence", on_delete=models.SET_NULL, null=True, related_name="first_seen_relations")
    src = models.ForeignKey(ExtractedEntity, on_delete=models.CASCADE, related_name="out_relations")
    dst = models.ForeignKey(ExtractedEntity, on_delete=models.CASCADE, related_name="in_relations")
    edge_type = models.CharField(max_length=32)
    confidence = models.FloatField(default=0.0)
    snippet = models.TextField(blank=True, default="")  # evidence sentence (the "why")
    engine = models.CharField(max_length=32, blank=True, default="")
    # Temporal validity: explicit date parsed from the evidence sentence, if any.
    # Undated relations carry NULL and always pass date-range filters.
    valid_from = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-confidence",)
        constraints = [
            models.UniqueConstraint(fields=["case", "src", "dst", "edge_type"], name="uniq_relation_per_case"),
        ]
        indexes = [models.Index(fields=["case", "status"])]


class MergeStatus(models.TextChoices):
    PENDING = "pending", "Pending decision"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"


class MergeSuggestion(models.Model):
    """Confidence-scored dedupe proposal. High-impact merges need SHO approval (§4.1)."""

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="merge_suggestions")
    entity_a = models.ForeignKey(ExtractedEntity, on_delete=models.CASCADE, related_name="merge_as_a")
    entity_b = models.ForeignKey(ExtractedEntity, on_delete=models.CASCADE, related_name="merge_as_b")
    score = models.FloatField(default=0.0)
    reason = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(max_length=16, choices=MergeStatus.choices, default=MergeStatus.PENDING)
    decided_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-score",)
        constraints = [
            models.UniqueConstraint(fields=["case", "entity_a", "entity_b"], name="uniq_merge_pair"),
        ]


class GraphSnapshot(models.Model):
    """Frozen graph view for reports + time comparison (§4.3).

    Stores the API-shaped {nodes, edges} payload plus the filters that
    produced it, so a snapshot renders identically later and two snapshots
    diff cleanly (added/removed by stable node/edge id).
    """

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="graph_snapshots")
    label = models.CharField(max_length=128)
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    filters = models.JSONField(default=dict, blank=True)
    data = models.JSONField(default=dict, blank=True)  # {"nodes": [...], "edges": [...]}
    node_count = models.IntegerField(default=0)
    edge_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
