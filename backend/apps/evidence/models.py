import hashlib

from django.db import models
from pgvector.django import VectorField

from apps.cases.models import Case


class EvidenceType(models.TextChoices):
    FIR = "fir", "FIR"
    CDR = "cdr", "CDR"
    BANK_STATEMENT = "bank_statement", "Bank statement"
    WITNESS_STATEMENT = "witness_statement", "Witness statement"
    PHOTO = "photo", "Photo"
    AUDIO_TRANSCRIPT = "audio_transcript", "Audio transcript"
    DOCUMENT = "document", "Document"
    OTHER = "other", "Other"


class Evidence(models.Model):
    """File metadata + hash. Binary lives in MinIO; OCR/NLP run as Celery tasks."""

    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="evidence")
    file_name = models.CharField(max_length=255)
    file_type = models.CharField(max_length=32, choices=EvidenceType.choices, default=EvidenceType.OTHER)
    mime_type = models.CharField(max_length=128, blank=True, default="")
    size_bytes = models.BigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, db_index=True)
    storage_key = models.CharField(max_length=512, blank=True, default="")
    uploaded_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True)
    # Phase 2: auto classification + OCR output. `ocr_text` feeds Phase 3 NER
    # and Phase 6 RAG; embeddings land in pgvector then.
    classification = models.CharField(max_length=64, blank=True, default="")
    classification_confidence = models.FloatField(default=0.0)
    ocr_status = models.CharField(max_length=32, default="pending")
    # pending|processing|done|failed|unavailable|skipped
    ocr_text = models.TextField(blank=True, default="")
    ocr_pages = models.IntegerField(default=0)
    ocr_engine = models.CharField(max_length=32, blank=True, default="")  # raw-text|pypdf-text|paddleocr
    # Multilingual routing (persisted, never discarded): ISO-639 code from
    # langdetect ("" = unknown/too-short), its profile score, and the NER
    # outcome — "" (not run) | ok | unsupported_language | skipped-empty | failed.
    detected_language = models.CharField(max_length=16, blank=True, default="")
    detected_language_confidence = models.FloatField(default=0.0)
    extraction_status = models.CharField(max_length=32, blank=True, default="")
    processing_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["case", "-created_at"])]  # per-case evidence lists

    @staticmethod
    def hash_bytes(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()


class CustodyAction(models.TextChoices):
    UPLOADED = "uploaded", "Uploaded"
    VIEWED = "viewed", "Viewed"
    DOWNLOADED = "downloaded", "Downloaded"
    CLASSIFIED = "classified", "Auto-classified"
    OCR_COMPLETED = "ocr_completed", "OCR completed"
    REPROCESSED = "reprocessed", "Reprocessed"
    DELETED = "deleted", "Deleted"
    ICJS_IMPORT = "icjs_import", "ICJS import"


class ChainOfCustody(models.Model):
    """Tamper-evident ledger: who touched a piece of evidence, when, what action.

    `evidence` is SET_NULL (never CASCADE) so deleting a file preserves its
    custody trail; `evidence_snapshot` keeps file_name/sha256 for context.
    """

    evidence = models.ForeignKey(Evidence, on_delete=models.SET_NULL, null=True, related_name="custody_entries")
    evidence_snapshot = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=32, choices=CustodyAction.choices)
    details = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-timestamp",)
        indexes = [models.Index(fields=["evidence", "timestamp"])]

    @staticmethod
    def log(evidence: Evidence | None, actor, action: str, details: dict | None = None, ip=None) -> "ChainOfCustody":
        snapshot = {}
        if evidence is not None:
            snapshot = {"file_name": evidence.file_name, "sha256": evidence.sha256, "case_id": evidence.case_id}
        return ChainOfCustody.objects.create(
            evidence=evidence,
            evidence_snapshot=snapshot,
            actor=actor,
            action=action,
            details=details or {},
            ip=ip,
        )


class DocumentChunk(models.Model):
    """RAG retrieval unit (Phase 6): ~800-char slices of evidence text.

    `embedding` is filled when GEMINI_API_KEY is configured (text-embedding-004,
    768d); chunks without embeddings still serve keyword retrieval — never fake
    vectors. Case is denormalized for access-scoped filtering.
    """

    evidence = models.ForeignKey(Evidence, on_delete=models.CASCADE, related_name="chunks")
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="chunks")
    chunk_index = models.IntegerField(default=0)
    text = models.TextField()
    embedding = VectorField(dimensions=768, null=True, blank=True)  # text-embedding-004
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("evidence", "chunk_index")
        constraints = [
            models.UniqueConstraint(fields=["evidence", "chunk_index"], name="uniq_chunk_per_evidence"),
        ]
