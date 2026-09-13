"""Indic NER path (Phase 3 multilingual): IndicNER + IndicXlit, lazy-loaded.

Pipeline position: `extract.extract_for_evidence()` routes trusted Indic
detections here; English/low-trust text never enters this module.

Steps per sentence:
  1. Romanized-fragment normalization — sentences containing Latin-script
     tokens pass through IndicXlit (ai4bharat-transliteration, roman→native
     for the detected language) so code-mixed "Rahul Sharma ne bataya" and
     native "राहुल शर्मा ने बताया" converge before NER. Fully native
     sentences skip this (identity transform would only add failure modes).
     Xlit failure degrades to the original sentence, logged — never fatal.
  2. Token classification with `ai4bharat/IndicNER` (AutoModelForToken-
     Classification + AutoTokenizer), loaded ONCE per worker process and
     cached in `_MODEL` (same lazy pattern as PaddleOCR in `ocr.py`).
     Model id is overridable via settings.INDIC_NER_MODEL_ID.
  3. Per-entity confidence = mean of the token softmax probabilities over
     the span, rounded to 4 decimals. These are the MODEL'S OWN numbers —
     nothing here is a literal. (Mean, not min: one uncertain subword
     should discount, not veto, a span; documented so the choice is
     reviewable.)
  4. Label mapping is explicit (INDIC_LABEL_MAP): PER/LOC/ORG plus the
     full-word and Naamapadam NEP/NEO/NEL aliases public checkpoints use.
     Labels outside the map (MISC, dates, designations, …) are SKIPPED with
     a warning, never force-fit into the taxonomy — a dropped misc entity
     is honest, a mislabeled one is not.

Output contract matches `extract.extract_entities` exactly
({node_type, value, normalized [filled by caller], confidence, span,
engine="indic-ner", source_evidence_id}) plus `native_snippet` (the native-
script sentence the span came from). Normalization/dedup stay in
`extract.py` so both paths share one `normalize_value`.

Honest degradation: anything missing — transformers/torch not installed,
model download gated/failed, OOM, tokenizer without offsets — raises
`IndicUnavailable(reason)`. The caller records extraction_status
"unsupported_language" and extracts NOTHING. This module never falls back
to spaCy itself.
"""
from __future__ import annotations

import logging
import math
import re

log = logging.getLogger(__name__)

ENGINE = "indic-ner"

# Explicit taxonomy map. IndicNER/Naamapadam emits BIO over PER/LOC/ORG;
# public per-language checkpoints vary (full words PERSON/LOCATION/
# ORGANIZATION, GPE, Naamapadam NEP/NEO/NEL), so those aliases map too.
# Anything else (MISC, dates, measures, designations, …) has no counterpart
# in NodeType and is SKIPPED loudly rather than guessed (see
# decode_predictions). O/OTHER are span boundaries, never entities.
INDIC_LABEL_MAP = {
    "PER": "Person",
    "PERSON": "Person",
    "NEP": "Person",
    "LOC": "Location",
    "LOCATION": "Location",
    "GPE": "Location",
    "NEL": "Location",
    "ORG": "Organization",
    "ORGANIZATION": "Organization",
    "NEO": "Organization",
}
_BOUNDARY_TAGS = frozenset({"O", "OTHER"})

# Sentence split honoring the Indic danda alongside Latin stops.
SENT_SPLIT_RE = re.compile(r"(?<=[.!?।])\s+")
LATIN_RE = re.compile(r"[A-Za-z]")
# Truncate per sentence at the BERT window minus specials.
MAX_TOKENS = 510


class IndicUnavailable(Exception):
    """Raised when the Indic path cannot run. `reason` is machine-readable."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"indic-ner unavailable ({reason}): {detail}"[:300])
        self.reason = reason
        self.detail = detail


_MODEL = None  # cached (tokenizer, model, id2label) or None
_MODEL_ERROR = None  # last load failure, for diagnostics
_XLIT_ENGINES: dict[str, object] = {}  # lang -> XlitEngine (or False when failed)


def model_id() -> str:
    """Configured checkpoint. Import settings lazily (bare-script safe)."""
    try:
        from django.conf import settings
        return getattr(settings, "INDIC_NER_MODEL_ID", "ai4bharat/IndicNER")
    except Exception:
        return "ai4bharat/IndicNER"


def _get_components():
    """Load (tokenizer, model, id2label) once per process. Never returns None."""
    global _MODEL, _MODEL_ERROR
    if _MODEL is not None:
        return _MODEL
    try:
        import torch  # noqa: F401  (inference backend; aligns with requirements-ml.txt)
    except ImportError:
        raise IndicUnavailable("no-torch", "torch is not installed (requirements-ml.txt)")
    try:
        from transformers import AutoModelForTokenClassification, AutoTokenizer
    except ImportError:
        raise IndicUnavailable("no-transformers", "transformers is not installed (requirements-ml.txt)")
    mid = model_id()
    try:
        tokenizer = AutoTokenizer.from_pretrained(mid, trust_remote_code=False)
        model = AutoModelForTokenClassification.from_pretrained(mid, trust_remote_code=False)
        model.eval()
    except Exception as exc:
        _MODEL_ERROR = str(exc)[:300]
        # Gated repos (ai4bharat/IndicNER requires HF access approval),
        # offline workers, and OOM all land here with the real message kept.
        raise IndicUnavailable("load-failed", _MODEL_ERROR)
    id2label = dict(getattr(model.config, "id2label", {}) or {})
    if not id2label:
        raise IndicUnavailable("no-labels", f"{mid} exposes no id2label map")
    _MODEL = (tokenizer, model, id2label)
    log.info("indic-ner loaded: %s (%d labels)", mid, len(id2label))
    return _MODEL


def softmax(logits: list[float]) -> list[float]:
    """Pure-python softmax (no torch needed: operates on plain lists, trivially testable)."""
    if not logits:
        return []
    m = max(logits)
    exps = [math.exp(v - m) for v in logits]
    s = sum(exps)
    return [e / s for e in exps]


def normalize_roman(text: str, lang: str) -> tuple[str, bool]:
    """Roman→native normalization for one sentence. Returns (text, applied).

    Sentences without Latin letters skip Xlit entirely (identity transforms
    only add latency and failure modes). Any Xlit problem — missing package,
    download failure, engine error — returns the input unchanged with
    applied=False. Never raises.
    """
    if not LATIN_RE.search(text):
        return text, False
    engine = _XLIT_ENGINES.get(lang, None)
    if engine is False:
        return text, False
    if engine is None:
        try:
            # Real v1.x API (verified against ai4bharat-transliteration 1.1.3):
            # factory XlitEngine(lang2use) roman->native; .translit_sentence
            # returns str. Construction downloads weights on first use and
            # calls exit() on failure — hence BaseException, not Exception.
            from ai4bharat.transliteration import XlitEngine
            engine = XlitEngine(lang, beam_width=4)
            _XLIT_ENGINES[lang] = engine
        except BaseException as exc:
            log.info("indicxlit unavailable for %s (%s); using raw text", lang, str(exc)[:120])
            _XLIT_ENGINES[lang] = False
            return text, False
    try:
        out = engine.translit_sentence(text, lang)
        if not isinstance(out, str) or not out.strip():
            return text, False
        return out, True
    except Exception as exc:
        log.debug("indicxlit failed, using raw text: %s", str(exc)[:150])
        return text, False


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in SENT_SPLIT_RE.split(text or "") if s.strip()]


def _tokenize(tokenizer, text: str) -> tuple[list[str], list[tuple[int, int]]]:
    """Tokenize with char offsets. Raises IndicUnavailable when unsupported."""
    try:
        enc = tokenizer(text, return_offsets_mapping=True, truncation=True,
                        max_length=MAX_TOKENS + 2, add_special_tokens=True)
    except Exception as exc:
        raise IndicUnavailable("tokenize-failed", str(exc)[:200])
    offsets = enc.get("offset_mapping") or []
    if not offsets:
        raise IndicUnavailable("no-offsets", "tokenizer exposes no offset mapping")
    tokens = tokenizer.convert_ids_to_tokens(enc["input_ids"])
    return tokens, [(int(a), int(b)) for a, b in offsets]


def _logits_for(model, tokenizer, text: str) -> tuple[list[str], list[tuple[int, int]], list[list[float]]]:
    """Run inference; returns (tokens, offsets, per-token logit lists).

    The ONLY torch-touching function in this module — everything downstream
    operates on plain lists, which is what makes the decode path unit-
    testable without a model.
    """
    import torch

    tokens, offsets = _tokenize(tokenizer, text)
    enc = tokenizer(text, return_tensors="pt", truncation=True,
                    max_length=MAX_TOKENS + 2, add_special_tokens=True)
    with torch.no_grad():
        out = model(**{k: v for k, v in enc.items() if k in ("input_ids", "attention_mask")})
    logits = out.logits[0].tolist()
    return tokens, offsets, [list(row) for row in logits]


def decode_predictions(tokens: list[str], offsets: list[tuple[int, int]],
                       logits: list[list[float]], id2label: dict,
                       text: str) -> tuple[list[dict], list[str]]:
    """BIO decode -> ([{surface, start, end, raw_label, confidence}], [skipped_labels]).

    Pure function (no model, no torch): unit tests drive it with canned
    logits. Continuation subwords (##) extend the current span; an I- tag
    whose type differs from the open span starts a new span (strict BIO).
    Special tokens (zero-width offsets) never open spans.
    """
    spans: list[dict] = []
    skipped: list[str] = []
    current: dict | None = None

    def close():
        nonlocal current
        if current is not None:
            probs = current.pop("probs")
            current["confidence"] = round(sum(probs) / len(probs), 4) if probs else 0.0
            mapped = INDIC_LABEL_MAP.get(current["raw_label"])
            if mapped is None:
                if current["raw_label"] not in skipped:
                    skipped.append(current["raw_label"])
            else:
                current["node_type"] = mapped
                spans.append(current)
            current = None

    for tok, (a, b), row in zip(tokens, offsets, logits):
        if b <= a:
            close()  # [CLS]/[SEP]/padding: boundary, never content
            continue
        probs = softmax(row)
        best = max(range(len(probs)), key=lambda i: probs[i])
        tag = str(id2label.get(best, id2label.get(str(best), "O")))
        if tag.upper() in _BOUNDARY_TAGS:
            close()
            continue
        prefix, _, typ = tag.partition("-")
        typ = (typ or prefix).upper()
        if prefix.upper().startswith("B") or current is None or current.get("raw_label") != typ:
            close()
            current = {"start": a, "end": b, "raw_label": typ, "probs": [probs[best]]}
        else:
            current["end"] = b
            current["probs"].append(probs[best])
    close()

    for s in spans:
        # ("probs" was already popped by close(); only the surface is new.)
        s["surface"] = text[s["start"]:s["end"]]
    if skipped:
        log.warning("indic-ner labels outside taxonomy skipped: %s", sorted(skipped))
    return spans, skipped


def extract_indic_entities(text: str, language: str, source_evidence_id: int | str = "") -> list[dict]:
    """Full Indic path -> extract_entities-compatible dicts (+ native_snippet).

    Raises IndicUnavailable when the model cannot run (caller records
    unsupported_language and extracts nothing). Never falls back to spaCy.
    """
    tokenizer, model, id2label = _get_components()
    found: list[dict] = []
    for sent in _sentences(text):
        if len(sent) > 4000:
            continue
        processed, _applied = normalize_roman(sent, language)
        tokens, offsets, logits = _logits_for(model, tokenizer, processed)
        spans, _skipped = decode_predictions(tokens, offsets, logits, id2label, processed)
        snippet = processed[:280]
        for s in spans:
            found.append({
                "node_type": s["node_type"],
                "value": s["surface"].strip(),
                "confidence": s["confidence"],
                "span": [s["start"], s["end"]],
                "engine": ENGINE,
                "native_snippet": snippet,
                "source_evidence_id": source_evidence_id,
            })
    # Best-span dedup on (type, value) — mirrors extract.py without importing it
    # at module level (extract.py imports this module for routing).
    best: dict[tuple[str, str], dict] = {}
    for ent in found:
        if not (ent["value"] or "").strip():
            continue
        key = (ent["node_type"], ent["value"].strip().lower())
        if key not in best or ent["confidence"] > best[key]["confidence"]:
            best[key] = ent
    deduped = list(best.values())
    # Alias folding (same rule as the English path): a single-token Person
    # span that is a token-part of a multi-token Person seen in the same
    # text ("विक्रम" beside "विक्रम पाटिल") is a mention, not an entity.
    # Measured 2026-09-13: removes fragment false-positives, never a full name.
    multi = {e["value"].strip().lower() for e in deduped
             if e["node_type"] == "Person" and len(e["value"].split()) > 1}
    kept = [e for e in deduped
            if not (e["node_type"] == "Person" and len(e["value"].split()) == 1
                    and any(e["value"].strip().lower() in m.split() for m in multi))]
    return sorted(kept, key=lambda e: e["span"][0])
