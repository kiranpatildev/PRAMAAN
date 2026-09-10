"""Shared evidence-creation entry point (hash -> MinIO -> row -> custody -> pipeline).

Both manual uploads (EvidenceViewSet.create) and external imports
(apps/icjs) MUST go through create_evidence() so there is exactly one
ingestion path. The only per-source differences are the custody action and
detail payload, which callers pass explicitly.
"""
import uuid

from apps.evidence.models import ChainOfCustody, CustodyAction, Evidence


def create_evidence(case, *, file_name, data, content_type="", uploaded_by=None,
                    file_type="other", custody_action=CustodyAction.UPLOADED,
                    custody_details=None, ip=None, trigger_pipeline=True):
    """Create one Evidence row from raw bytes. Never raises for storage failures.

    Raises ValueError on empty data (callers map this to 400 / failed-file).
    Returns the refreshed Evidence instance.
    """
    from apps.evidence.services import storage

    if not data:
        raise ValueError("Empty file.")
    safe_name = (file_name or "upload").replace("/", "_").replace("\\", "_")
    storage_key = f"cases/{case.id}/{uuid.uuid4().hex}_{safe_name}"
    processing_error = ""
    try:
        storage.upload_bytes(storage_key, data, content_type or "application/octet-stream")
    except Exception as exc:
        # Object store down: keep metadata + hash (chain-of-custody intact),
        # pipeline stages that need bytes defer until /reprocess/.
        processing_error = f"storage upload: {exc}"[:1000]
    ev = Evidence.objects.create(
        case=case,
        file_name=file_name,
        file_type=file_type,
        mime_type=content_type or "",
        size_bytes=len(data),
        sha256=Evidence.hash_bytes(data),
        storage_key=storage_key,
        uploaded_by=uploaded_by,
        processing_error=processing_error,
    )
    details = {"sha256": ev.sha256, "size_bytes": ev.size_bytes,
               "stored": not bool(processing_error)}
    details.update(custody_details or {})
    ChainOfCustody.log(ev, uploaded_by, custody_action, details, ip=ip)
    if trigger_pipeline:
        from apps.evidence.tasks import process_evidence
        process_evidence.delay(ev.id)
    ev.refresh_from_db()
    return ev
