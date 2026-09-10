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

Transliteration (IndicXlit, requirements-ml.txt) plugs into `transliterate()`
behind a lazy import; until then matching is script-exact plus normalization.
"""
from __future__ import annotations

import difflib
import logging
import re

log = logging.getLogger(__name__)

SUGGEST_THRESHOLD = 0.75
AUTO_MERGE_THRESHOLD = 0.99  # reserved: even phone-anchors need confirmation in Phase 3


def transliterate(text: str, target_script: str = "latin") -> str:
    """Normalize names across scripts (Devanagari <-> Latin). Falls back to input."""
    try:
        from indicxlib import indicxlit  # type: ignore  # requirements-ml.txt
        raise ImportError  # placeholder wiring — real call once the dep is pinned
    except Exception:
        return text


def _tokens(norm: str) -> list[str]:
    return [t for t in re.split(r"[\s.\-]+", norm) if t]


def person_score(a: str, b: str) -> tuple[float, str]:
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
