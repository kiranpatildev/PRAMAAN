"""Entity resolution (Phase 3): blocking + scored merge suggestions.

Matching rules (conservative — a wrong merge corrupts the graph, so every
suggestion needs investigator confirmation, and high-impact merges need SHO
approval per §4.1):
  PhoneNumber: identical digits -> 1.0 (phones are identity anchors).
  Vehicle:     identical normalized plate -> 1.0; difflib >= 0.9 -> scaled.
  Person:      exact -> 0.95; initial+surname ("R. Sharma" vs "Rahul Sharma")
               -> 0.80; token overlap + difflib -> scaled, floor 0.75 to suggest.
  Location/Organization: exact -> 0.90; difflib >= 0.85 -> scaled.
  Event: never auto-suggested (time-bound, matched exactly in graph writes).

Cross-script matching goes through `transliterate()` (IndicXlit, lazy): when
both names are Latin the fallback is a no-op and scoring is byte-identical
to script-exact matching; when IndicXlit is absent the function is the
identity and nothing changes. Only Person pairs use the fallback (places
and orgs transliterate too noisily for merge-grade claims).
"""
from __future__ import annotations

import difflib
import logging
import re

log = logging.getLogger(__name__)

SUGGEST_THRESHOLD = 0.75
AUTO_MERGE_THRESHOLD = 0.99  # reserved: even phone-anchors need confirmation in Phase 3


# Unicode block starts per Indic script -> Xlit lang code (first hit wins).
# Devanagari serves hi/mr/ne; "hi" is the documented approximation for
# matching purposes only (never persisted, never shown).
_SCRIPT_LANG = [
    (0x0900, 0x097F, "hi"),   # Devanagari
    (0x0980, 0x09FF, "bn"),   # Bengali (+Assamese range overlap)
    (0x0A00, 0x0A7F, "pa"),   # Gurmukhi
    (0x0A80, 0x0AFF, "gu"),   # Gujarati
    (0x0B00, 0x0B7F, "or"),   # Odia
    (0x0B80, 0x0BFF, "ta"),   # Tamil
    (0x0C00, 0x0C7F, "te"),   # Telugu
    (0x0C80, 0x0CFF, "kn"),   # Kannada
    (0x0D00, 0x0D7F, "ml"),   # Malayalam
]

_XLIT_INDIC2EN = None  # engine singleton, or False when unavailable


def _guess_lang(text: str) -> str | None:
    for ch in text or "":
        o = ord(ch)
        for lo, hi, lang in _SCRIPT_LANG:
            if lo <= o <= hi:
                return lang
    return None


def _indic2en_engine():
    global _XLIT_INDIC2EN
    if _XLIT_INDIC2EN is None:
        try:
            # Real v1.x API (ai4bharat-transliteration 1.1.3): factory with
            # src_script_type="indic"; .translit_sentence(text, lang) -> str.
            # Construction downloads weights on first use and calls exit()
            # on failure — hence BaseException.
            from ai4bharat.transliteration import XlitEngine
            _XLIT_INDIC2EN = XlitEngine(src_script_type="indic")
        except BaseException as exc:
            log.debug("indicxlit indic2en unavailable: %s", str(exc)[:120])
            _XLIT_INDIC2EN = False
    return _XLIT_INDIC2EN or None


def transliterate(text: str, target_script: str = "latin") -> str:
    """Normalize names across scripts (Indic -> Latin). Falls back to input.

    Only target_script="latin" is implemented (the matching direction).
    Pure-ASCII input returns immediately without touching the engine.
    Never raises.
    """
    if not text or target_script != "latin":
        return text
    try:
        if text.isascii():
            return text
    except Exception:
        return text
    lang = _guess_lang(text)
    if lang is None:
        return text
    engine = _indic2en_engine()
    if engine is None:
        return text
    try:
        out = engine.translit_sentence(text, lang)
        return out.strip() if isinstance(out, str) and out.strip() else text
    except Exception:
        return text


def _tokens(norm: str) -> list[str]:
    return [t for t in re.split(r"[\s.\-]+", norm) if t]


def _person_score_latin(a: str, b: str) -> tuple[float, str]:
    """Latin-script person scoring (exact/initial/subset/fuzzy)."""
    if a == b:
        return 0.95, "exact-name"
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0, ""
    # Same surname: check initial-vs-full first names ("r sharma" vs
    # "rahul sharma", any token-length pattern) and subset matches.
    if ta[-1] == tb[-1]:
        fa, fb = ta[0], tb[0]
        if len(fa) == 1 or len(fb) == 1:
            initial, full = (fa, fb) if len(fa) == 1 else (fb, fa)
            if len(full) > 1 and full.startswith(initial):
                return 0.80, "initial-surname"
        if len(ta) != len(tb):
            short, long = (ta, tb) if len(ta) < len(tb) else (tb, ta)
            if set(short) <= set(long):
                return 0.78, "name-subset"
    if ta[-1] != tb[-1]:
        return 0.0, ""  # different surnames never merge
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    overlap = len(set(ta) & set(tb)) / max(len(set(ta) | set(tb)), 1)
    score = 0.5 * ratio + 0.5 * overlap
    if score >= 0.75:
        return round(min(score, 0.94), 3), "fuzzy-name"
    return 0.0, ""


def person_score(a: str, b: str) -> tuple[float, str]:
    """Person matching with a cross-script fallback.

    Same-script pairs (and everything when IndicXlit is absent) score exactly
    as before. When the pair spans scripts AND transliteration changes at
    least one side, the transliterated forms re-enter Latin scoring capped at
    0.85 ("xlit-" reasons) — below exact-name (0.95), so a transliteration
    guess can suggest but never outrank a true exact match.
    """
    score, reason = _person_score_latin(a, b)
    if score > 0.0:
        return score, reason
    ta, tb = transliterate(a), transliterate(b)
    if ta == a and tb == b:
        return 0.0, ""
    score, reason = _person_score_latin(ta, tb)
    if score > 0.0:
        return round(min(score, 0.85), 3), f"xlit-{reason}"
    return 0.0, ""


def match_score(node_type: str, a: str, b: str) -> tuple[float, str]:
    if not a or not b or a == b and node_type == "Event":
        if node_type == "Event":
            return (1.0, "exact-event") if a == b else (0.0, "")
    if node_type == "PhoneNumber":
        return (1.0, "same-phone") if a == b else (0.0, "")
    if node_type == "Vehicle":
        if a == b:
            return 1.0, "same-plate"
        ratio = difflib.SequenceMatcher(None, a, b).ratio()
        return (round(ratio, 3), "fuzzy-plate") if ratio >= 0.9 else (0.0, "")
    if node_type == "Person":
        return person_score(a, b)
    if node_type in ("Location", "Organization"):
        if a == b:
            return 0.90, "exact"
        ratio = difflib.SequenceMatcher(None, a, b).ratio()
        return (round(ratio * 0.9, 3), "fuzzy") if ratio >= 0.85 else (0.0, "")
    return (0.0, "")


def _block_key(node_type: str, normalized: str) -> tuple:
    """Blocking key: cheap partition so scoring stays O(bucket^2), not O(n^2).

    Persons block on (surname, first-initial) so "R. Sharma" still meets
    "Rahul Sharma"; everything else blocks on the first two alpha chars.
    """
    if node_type == "Person":
        toks = [t for t in re.split(r"[\s.\-]+", normalized) if t]
        surname = toks[-1] if toks else ""
        initial = toks[0][:1] if toks else ""
        return (node_type, surname, initial)
    alpha = re.sub(r"[^a-z]", "", normalized)[:2]
    return (node_type, alpha)


def find_merge_candidates(entities: list) -> list[dict]:
    """Pairwise scoring with surname/initial blocking (see _block_key).

    `entities`: iterable of objects with .id/.node_type/.normalized/.value.
    Returns [{a_id, b_id, score, reason}] with score >= SUGGEST_THRESHOLD.
    """
    blocks: dict[tuple, list] = {}
    for e in entities:
        if e.node_type == "Event":
            continue
        blocks.setdefault(_block_key(e.node_type, e.normalized), []).append(e)
    suggestions = []
    seen_pairs: set[tuple[int, int]] = set()
    for bucket in blocks.values():
        for i, a in enumerate(bucket):
            for b in bucket[i + 1:]:
                pair = (min(a.id, b.id), max(a.id, b.id))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                score, reason = match_score(a.node_type, a.normalized, b.normalized)
                if score >= SUGGEST_THRESHOLD:
                    suggestions.append({
                        "a_id": a.id, "b_id": b.id,
                        "a_value": a.value, "b_value": b.value,
                        "node_type": a.node_type,
                        "score": score, "reason": reason,
                    })
    return sorted(suggestions, key=lambda s: -s["score"])
