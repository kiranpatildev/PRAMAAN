"""Text extraction service (Phase 2): embedded text layer first, PaddleOCR second.

Engine selection (cheap -> expensive):
  1. `raw-text`   — plain text / CSV / spreadsheet-bytes decoded directly.
  2. `pypdf-text` — PDFs with an embedded text layer (digital FIRs, statements).
  3. `paddleocr`  — scanned documents / photos; imported lazily so the base
                    install stays light. Heavy ML deps live in
                    `requirements-ml.txt`; without them scanned images report
                    status `unavailable` instead of failing the pipeline.

Contract: extract_text(data, mime_type, file_name) ->
  {"text": str, "pages": int, "engine": str, "confidence": float, "status": str}
where status is one of done | unavailable | skipped | failed.
"""
from __future__ import annotations

import io
import logging
import os
import tempfile

log = logging.getLogger(__name__)

TEXT_MIMES = {"text/plain", "text/csv"}
TEXT_EXTS = {".txt", ".csv", ".log", ".tsv"}
IMAGE_MIMES = {"image/jpeg", "image/png", "image/tiff", "image/bmp", "image/webp"}
MIN_TEXT_CHARS = 50  # below this a PDF counts as scanned, not digital


def decode_bytes(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, ValueError):
            continue
    return ""


def sample_text(data: bytes, mime_type: str = "", file_name: str = "", limit: int = 4000) -> str:
    """Cheap sniffable head for the classifier — never runs OCR."""
    ext = os.path.splitext(file_name or "")[1].lower()
    if (mime_type or "").lower() in TEXT_MIMES or ext in TEXT_EXTS or ext in {".xls", ".xlsx"}:
        return decode_bytes(data[:200_000])[:limit]
    if (mime_type or "").lower() == "application/pdf" or ext == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            texts = [(page.extract_text() or "") for page in reader.pages[:2]]
            return "\n".join(texts)[:limit]
        except Exception as exc:  # corrupt/encrypted PDFs must not break classification
            log.debug("pdf sample extraction failed: %s", exc)
            return ""
    return decode_bytes(data[:512])[:limit]


def extract_text(data: bytes, mime_type: str = "", file_name: str = "") -> dict:
    mime = (mime_type or "").lower()
    ext = os.path.splitext(file_name or "")[1].lower()
    try:
        if mime in TEXT_MIMES or ext in TEXT_EXTS:
            text = decode_bytes(data)
            return {"text": text, "pages": 1, "engine": "raw-text", "confidence": 1.0, "status": "done"}
        if mime == "application/pdf" or ext == ".pdf":
            return _extract_pdf(data)
        if mime in IMAGE_MIMES or ext in {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}:
            return _extract_image(data)
        return {"text": "", "pages": 0, "engine": "none", "confidence": 0.0, "status": "skipped"}
    except Exception as exc:  # never let OCR crash the pipeline; tasks record the error
        log.exception("text extraction failed for %s", file_name)
        return {"text": "", "pages": 0, "engine": "none", "confidence": 0.0, "status": "failed", "error": str(exc)[:500]}


def _extract_pdf(data: bytes) -> dict:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    pages = len(reader.pages)
    texts = [(page.extract_text() or "") for page in reader.pages]
    combined = "\n".join(t for t in texts if t).strip()
    if len(combined) >= MIN_TEXT_CHARS:
        return {"text": combined, "pages": pages, "engine": "pypdf-text", "confidence": 0.95, "status": "done"}
    # Scanned PDF: would need rasterization + PaddleOCR (Phase 2 backlog — needs
    # poppler + paddle in the ML image). Report honestly instead of fake text.
    return {"text": "", "pages": pages, "engine": "paddleocr", "confidence": 0.0, "status": "unavailable"}


def _extract_image(data: bytes) -> dict:
    text = _paddle_ocr_image(data)
    if text is None:
        return {"text": "", "pages": 1, "engine": "paddleocr", "confidence": 0.0, "status": "unavailable"}
    return {"text": text, "pages": 1, "engine": "paddleocr", "confidence": 0.80, "status": "done"}


def _paddle_ocr_image(data: bytes) -> str | None:
    """Return extracted text, or None when PaddleOCR isn't installed/fails."""
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        log.info("PaddleOCR not installed (see requirements-ml.txt); image OCR unavailable.")
        return None
    try:
        ocr = PaddleOCR(lang="en", show_log=False)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            result = ocr.predict(tmp_path)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        lines: list[str] = []
        for page in result or []:
            texts = page.get("rec_texts") or []
            lines.extend(t for t in texts if t)
        return "\n".join(lines)
    except Exception:
        log.exception("PaddleOCR inference failed")
        return None
