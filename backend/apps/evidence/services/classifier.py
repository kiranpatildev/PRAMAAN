"""Heuristic evidence classifier (Phase 2).

Detects FIR / CDR / bank statement / witness statement / photo / transcript /
document from filename + MIME + a sniffed text sample. Returns a label +
confidence so the investigator review queue (Phase 3) can threshold on it.

A learned text classifier can replace `classify()` behind the same
`-> {"label", "confidence", "reason"}` contract without touching callers.
"""
from __future__ import annotations

import os

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".amr"}
SPREADSHEET_EXTS = {".csv", ".xls", ".xlsx"}

# keyword -> (label, confidence); order matters — first match wins.
FILENAME_RULES: list[tuple[list[str], str, float]] = [
    (["first information", "fir"], "fir", 0.80),
    (["cdr", "call detail", "call-detail", "tower dump", "tower-dump", "dump"], "cdr", 0.80),
    (["witness"], "witness_statement", 0.80),
    (["bank", "passbook", "account statement", "cheque"], "bank_statement", 0.75),
    (["transcript", "interview", "recording", "statement-record"], "audio_transcript", 0.75),
    (["invoice", "bill"], "document", 0.60),
]

# marker groups; >=2 distinct hits in the sniffed sample => strong content signal.
CONTENT_RULES: list[tuple[list[str], str, float]] = [
    (["msisdn", "imei", "imsi", "calling", "called party", "call type", "tower", "roaming"], "cdr", 0.90),
    (["ifsc", "narration", "debit", "credit", "branch", "account no", "available balance"], "bank_statement", 0.90),
    (["first information report", "police station", "complainant", "u/s", "accused person"], "fir", 0.90),
    (["witness statement", "deponent", "solemnly affirm"], "witness_statement", 0.85),
]


def classify(file_name: str = "", mime_type: str = "", text_sample: str = "") -> dict:
    name = (file_name or "").lower()
    mime = (mime_type or "").lower()
    sample = (text_sample or "").lower()
    ext = os.path.splitext(name)[1].lower()

    # 1. Strong content signal wins over filename hints.
    if sample:
        for markers, label, conf in CONTENT_RULES:
            if sum(1 for m in markers if m in sample) >= 2:
                return {"label": label, "confidence": conf, "reason": "content-markers"}

    # 2. Filename hints.
    for keywords, label, conf in FILENAME_RULES:
        if any(k in name for k in keywords):
            return {"label": label, "confidence": conf, "reason": "filename"}

    # 3. Extension / MIME fallback.
    if ext in IMAGE_EXTS or mime.startswith("image/"):
        return {"label": "photo", "confidence": 0.90, "reason": "extension"}
    if ext in AUDIO_EXTS or mime.startswith("audio/"):
        return {"label": "audio_transcript", "confidence": 0.85, "reason": "extension"}
    if ext in SPREADSHEET_EXTS:
        return {"label": "cdr", "confidence": 0.55, "reason": "spreadsheet-default"}
    if ext == ".pdf" or mime == "application/pdf":
        return {"label": "document", "confidence": 0.50, "reason": "pdf-default"}
    if ext in {".txt", ".doc", ".docx"}:
        return {"label": "document", "confidence": 0.50, "reason": "extension"}

    return {"label": "other", "confidence": 0.30, "reason": "fallback"}
