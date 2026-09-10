"""Async ingestion pipeline — one Celery task per stage (§10.3).

Stage contracts:
  ingest_evidence(evidence_id: int) -> {"storage_key": str, "sha256": str, ...}
  classify_file(evidence_id: int)   -> {"label": str, "confidence": float}
  run_ocr(evidence_id: int)         -> {"text_chars": int, "pages": int, "engine": str}
  process_evidence(evidence_id)     -> orchestrator running all three in order.

Resilience rule: a stage never raises — failures are recorded on
`Evidence.processing_error` (+ custody log) so one bad file can't poison the
queue. Bytes are re-downloaded from MinIO per stage needing them.
"""
from __future__ import annotations

import logging

from celery import shared_task

log = logging.getLogger(__name__)


def _get_evidence(evidence_id: int):
    from .models import Evidence
    try:
        return Evidence.objects.get(pk=evidence_id)
    except Evidence.DoesNotExist:
        return None


@shared_task
def ingest_evidence(evidence_id: int) -> dict:
    """Verify the uploaded object exists in MinIO (upload happens inline in the view)."""
    from apps.evidence.services import storage

    ev = _get_evidence(evidence_id)
    if ev is None:
        return {"evidence_id": evidence_id, "stage": "ingest", "status": "missing"}
    try:
        if not storage.object_exists(ev.storage_key):
            ev.processing_error = f"object not found in store: {ev.storage_key}"
            ev.save(update_fields=["processing_error", "updated_at"])
            return {"evidence_id": ev.id, "stage": "ingest", "status": "missing-object"}
        return {"evidence_id": ev.id, "stage": "ingest", "status": "ok",
                "storage_key": ev.storage_key, "sha256": ev.sha256}
    except Exception as exc:
        log.exception("ingest failed for evidence %s", evidence_id)
        ev.processing_error = f"ingest: {exc}"[:1000]
        ev.save(update_fields=["processing_error", "updated_at"])
        return {"evidence_id": ev.id, "stage": "ingest", "status": "failed"}


@shared_task
def classify_file(evidence_id: int) -> dict:
    from apps.evidence.services import storage
    from apps.evidence.services.classifier import classify
    from apps.evidence.services.ocr import sample_text
    from .models import ChainOfCustody, CustodyAction

    ev = _get_evidence(evidence_id)
    if ev is None:
        return {"evidence_id": evidence_id, "stage": "classify", "status": "missing"}
    try:
        try:
            sample = sample_text(storage.download_bytes(ev.storage_key), ev.mime_type, ev.file_name)
        except Exception as exc:
            log.warning("classify: byte sniff failed for %s (%s); filename-only", ev.id, exc)
            sample = ""
        result = classify(ev.file_name, ev.mime_type, sample)
        ev.classification = result["label"]
        ev.classification_confidence = result["confidence"]
        ev.processing_error = ""
        ev.save(update_fields=["classification", "classification_confidence", "processing_error", "updated_at"])
        ChainOfCustody.log(ev, None, CustodyAction.CLASSIFIED,
                           {"label": result["label"], "confidence": result["confidence"], "reason": result["reason"]})
        return {"evidence_id": ev.id, "stage": "classify", "status": "ok", **result}
    except Exception as exc:
        log.exception("classify failed for evidence %s", evidence_id)
        ev.processing_error = f"classify: {exc}"[:1000]
        ev.save(update_fields=["processing_error", "updated_at"])
        return {"evidence_id": ev.id, "stage": "classify", "status": "failed"}


@shared_task
def run_ocr(evidence_id: int) -> dict:
    from apps.evidence.services import storage
    from apps.evidence.services.ocr import extract_text
    from .models import ChainOfCustody, CustodyAction

    ev = _get_evidence(evidence_id)
    if ev is None:
        return {"evidence_id": evidence_id, "stage": "ocr", "status": "missing"}
    ev.ocr_status = "processing"
    ev.save(update_fields=["ocr_status", "updated_at"])
    try:
        data = storage.download_bytes(ev.storage_key)
    except Exception as exc:
        log.warning("ocr: download failed for %s (%s)", ev.id, exc)
        ev.ocr_status = "pending"
        ev.processing_error = f"ocr download: {exc}"[:1000]
        ev.save(update_fields=["ocr_status", "processing_error", "updated_at"])
        return {"evidence_id": ev.id, "stage": "ocr", "status": "deferred"}
    result = extract_text(data, ev.mime_type, ev.file_name)
    ev.ocr_text = result.get("text", "")
    ev.ocr_pages = result.get("pages", 0)
    ev.ocr_engine = result.get("engine", "")
    ev.ocr_status = result.get("status", "failed")
    ev.processing_error = result.get("error", "")
    ev.save(update_fields=["ocr_text", "ocr_pages", "ocr_engine", "ocr_status", "processing_error", "updated_at"])
    ChainOfCustody.log(ev, None, CustodyAction.OCR_COMPLETED,
                       {"engine": ev.ocr_engine, "status": ev.ocr_status,
                        "pages": ev.ocr_pages, "chars": len(ev.ocr_text)})
    return {"evidence_id": ev.id, "stage": "ocr", "status": ev.ocr_status,
            "text_chars": len(ev.ocr_text), "pages": ev.ocr_pages, "engine": ev.ocr_engine}


@shared_task
def process_evidence(evidence_id: int) -> dict:
    """Orchestrator: ingest -> classify -> ocr -> NER -> relations -> resolve -> index."""
    from apps.graph_api.tasks import extract_entities, extract_relations, resolve_entities  # lazy: avoids app cycle

    ingest = ingest_evidence(evidence_id)
    classified = classify_file(evidence_id)
    ocr = run_ocr(evidence_id)
    ner = extract_entities(evidence_id)
    relations = extract_relations(evidence_id)
    resolved = {"status": "skipped"}
    try:
        from .models import Evidence
        resolved = resolve_entities(Evidence.objects.get(pk=evidence_id).case_id)
    except Exception as exc:
        resolved = {"status": "failed", "error": str(exc)[:200]}
    indexed = index_evidence(evidence_id)
    return {"evidence_id": evidence_id, "stages": {
        "ingest": ingest, "classify": classified, "ocr": ocr,
        "ner": ner, "relations": relations, "resolve": resolved, "index": indexed}}


@shared_task
def index_evidence(evidence_id: int) -> dict:
    """Chunk ocr_text + embed for RAG (Phase 6). Idempotent reindex.

    Embeddings are key-optional: without GEMINI_API_KEY chunks are stored
    embedding-free for keyword retrieval (honest degradation, never fake vectors).
    """
    from apps.copilot.services.chunking import chunk_text
    from apps.copilot.services.gemini import GeminiUnavailable, embed_texts
    from .models import DocumentChunk, Evidence

    try:
        ev = Evidence.objects.get(pk=evidence_id)
    except Evidence.DoesNotExist:
        return {"evidence_id": evidence_id, "stage": "index", "status": "missing"}
    text = (ev.ocr_text or "").strip()
    if not text:
        return {"evidence_id": ev.id, "stage": "index", "status": "skipped-empty"}
    try:
        chunks = chunk_text(text)
        try:
            vectors = embed_texts(chunks)
            embedded = sum(1 for v in vectors if v)
        except GeminiUnavailable:
            vectors = [None] * len(chunks)
            embedded = 0
        DocumentChunk.objects.filter(evidence=ev).delete()
        DocumentChunk.objects.bulk_create([
            DocumentChunk(evidence=ev, case=ev.case, chunk_index=i, text=c, embedding=v)
            for i, (c, v) in enumerate(zip(chunks, vectors))
        ])
        return {"evidence_id": ev.id, "stage": "index", "status": "ok",
                "chunks": len(chunks), "embedded": embedded}
    except Exception as exc:
        log.exception("index failed for evidence %s", evidence_id)
        return {"evidence_id": ev.id, "stage": "index", "status": "failed",
                "error": str(exc)[:300]}
