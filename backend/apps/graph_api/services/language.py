"""Language detection for extraction routing (Phase 3 multilingual).

`detect_language()` runs on OCR text before NER and decides which extraction
path handles the evidence:

  trusted Indic code (hi/mr/bn/…) -> IndicNER path (`indic_extract`)
  anything else                    -> existing English path, byte-identical

Empirically grounded thresholds (measured 2026-09-13 on witness-style
fixtures, langdetect 1.0.9):

  Hindi sentences      -> hi @ 1.00
  Marathi sentences    -> mr @ 0.86-1.00
  Tamil / Bengali      -> ta / bn @ 1.00
  English              -> en @ 1.00
  Romanized Hindi only -> id @ 0.71 (wrong: Latin-script Hindi looks
                          Indonesian to n-gram profiles — routes to the
                          English path by the unknown-code rule below)
  Short strings ("Rahul Sharma" -> so, "9876543210 …" -> hu,
  Devanagari "Rahul Sharma" -> ne) are misdetected near-randomly, so text
  under MIN_CHARS_FOR_DETECTION is never trusted.

Routing rule (honest by construction): only a *trusted* detection of a
*supported* Indic language takes the Indic path. Everything Latin-script —
English, low-trust, unknown-code, short, empty, or a trusted non-Indic code
on Latin text (e.g. romanized Hindi read as Indonesian) — takes the existing
English path: zero behavior change, since that path handled all such text
before. A trusted non-Indic detection on NON-Latin-script text (Tamil with
no model, Urdu, …) is NOT silently spaCy'd: `extract_for_evidence()`
returns status "unsupported_language" and extracts nothing. langdetect
probabilities are length-normalized profile scores, not calibrated
confidences — the 0.60 bar is a routing gate, never shown to users.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)

# langdetect probability gate. Measured Indic fixtures score 0.86-1.00;
# nothing real should live near the boundary, and short-text noise (so/hu/ne
# @ 0.68-1.00) is excluded separately by the length floor below.
TRUST_THRESHOLD = 0.60
# Below this, langdetect output is near-random (measured: 2-word strings and
# digit/plate-only text misdetect with HIGH pseudo-confidence). Never trusted.
MIN_CHARS_FOR_DETECTION = 40

# IndicNER (Naamapadam-11) coverage per publication: as bn gu hi kn ml mr
# or pa ta te. Note: the HF card tags observed 2026-09-13 list as bn gu hi
# kn ml mr or pa ta (no te) — Telugu stays routed per the paper; its
# per-entity softmax confidences remain the model's own honest signal, and
# investigators confirm/reject every row regardless of path.
INDIC_SUPPORTED = frozenset({"hi", "mr", "bn", "ta", "te", "kn", "ml", "gu", "pa", "or", "as"})

LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "mr": "Marathi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "kn": "Kannada",
    "ml": "Malayalam",
    "gu": "Gujarati",
    "pa": "Punjabi",
    "or": "Odia",
    "as": "Assamese",
    "ur": "Urdu",
}


def language_name(code: str) -> str:
    """Display name for a detected code; unknown codes echo back, never blank."""
    if not code:
        return "Unknown"
    return LANGUAGE_NAMES.get(code.lower(), code)


def detect_language(text: str) -> dict:
    """Detect language -> {code, name, confidence, trusted}. Never raises.

    code is "" when nothing can be said (empty text, detector missing,
    detector error). confidence is the top langdetect probability (0.0 when
    unknown). trusted is True only when the text is long enough AND the
    top probability clears TRUST_THRESHOLD.
    """
    text = (text or "").strip()
    if len(text) < MIN_CHARS_FOR_DETECTION:
        return {"code": "", "name": "Unknown", "confidence": 0.0, "trusted": False}
    try:
        from langdetect import detect_langs
    except ImportError:
        log.warning("langdetect not installed — language detection unavailable")
        return {"code": "", "name": "Unknown", "confidence": 0.0, "trusted": False}
    try:
        langs = detect_langs(text)
    except Exception as exc:
        log.debug("language detection failed: %s", exc)
        return {"code": "", "name": "Unknown", "confidence": 0.0, "trusted": False}
    if not langs:
        return {"code": "", "name": "Unknown", "confidence": 0.0, "trusted": False}
    top = langs[0]
    code = (top.lang or "").lower()
    confidence = round(float(top.prob), 4)
    trusted = confidence >= TRUST_THRESHOLD
    return {"code": code, "name": language_name(code), "confidence": confidence, "trusted": trusted}


def _has_non_latin_letters(text: str) -> bool:
    """True when text contains alphabetic characters outside Latin blocks.

    Decides whether the English pipeline would produce garbage on the text:
    Latin-script text (even mislabeled, e.g. romanized Hindi detected as
    Indonesian) degrades gracefully through regex+spaCy — that was the
    pre-multilingual behavior for ALL text. Native-script text through
    en_core_web_sm is garbage and must never run.
    """
    for ch in text or "":
        if ch.isalpha() and ord(ch) > 0x024F:
            return True
    return False


def route_for(detection: dict, text: str = "") -> str:
    """Route a detection dict to "indic" / "english" / "unsupported".

    Only trusted + supported-Indic detections take the Indic path. English,
    untrusted, unknown, empty, and trusted-but-non-Indic LATIN-script text
    take the existing English path unchanged (zero regression: that path
    handled all such text before). Trusted non-Indic detections on
    NON-Latin-script text (Tamil with no model, Urdu, …) return
    "unsupported": the caller records that state and extracts nothing
    rather than spaCy garbage.
    """
    code = (detection or {}).get("code", "")
    trusted = bool((detection or {}).get("trusted", False))
    if trusted and code in INDIC_SUPPORTED:
        return "indic"
    if trusted and code and code != "en" and _has_non_latin_letters(text):
        return "unsupported"
    return "english"
