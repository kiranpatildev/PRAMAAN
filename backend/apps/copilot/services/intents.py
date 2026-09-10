"""Question-intent router (Phase 6): no LLM needed for routing.

  path .... "how is X connected to Y", "connection between X and Y", "X -> Y"
  summary . "summarize", "key players", "overview", "brief"
  generic . everything else -> hybrid retrieval QA
"""
from __future__ import annotations

import re

_PATH_RES = [
    re.compile(r"how\s+(?:is|are)\s+(.+?)\s+(?:connected|linked|related|associated)\s+(?:to|with)\s+(.+?)\s*\??$", re.I),
    re.compile(r"(?:connection|link|relation|relationship)\s+(?:between|of)\s+(.+?)\s+and\s+(.+?)\s*\??$", re.I),
    re.compile(r"(.+?)\s*(?:->|→)\s*(.+?)\s*\??$", re.I),
]
_SUMMARY_RES = [
    re.compile(r"\b(summar(y|ize|ise)|tldr)\b", re.I),
    re.compile(r"\bkey\s+players?\b", re.I),
    re.compile(r"\b(overview|brief(\s+me)?|status)\b", re.I),
]


def _clean(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().strip("\"'")).strip()


def classify(question: str) -> tuple[str, dict]:
    """Return (intent, slots). Intent in {path, summary, generic}."""
    q = (question or "").strip()
    for rx in _PATH_RES:
        m = rx.search(q)
        if m:
            a, b = _clean(m.group(1)), _clean(m.group(2))
            if a and b and len(a) < 120 and len(b) < 120:
                return "path", {"a": a, "b": b}
    for rx in _SUMMARY_RES:
        if rx.search(q):
            return "summary", {}
    return "generic", {}
