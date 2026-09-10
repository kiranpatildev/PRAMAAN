"""Hybrid retrieval (Phase 6): vector similarity + keyword, case-scoped.

- Vector leg runs only when embeddings are configured AND the query embeds
  cleanly; chunks without embeddings simply don't vector-match.
- Keyword leg always runs: postgres full-text rank, icontains fallback
  elsewhere (works on sqlite, worse ranking — documented degradation).
- Merge: vector hits first, keyword fills the rest, deduped by chunk.
- Callers pass explicit case ids; access control lives with the caller.
"""
from __future__ import annotations

import logging

from django.db import connection

log = logging.getLogger(__name__)

DEFAULT_TOP_K = 6


def retrieve(query: str, case_ids: list[int] | None, limit: int = DEFAULT_TOP_K) -> dict:
    """Return {hits: [...], vector_used: bool}.

    hit = {chunk_id, evidence_id, case_id, file_name, text, score, method}.
    case_ids=None means all cases (SHO); callers enforce visibility first.
    """
    from apps.evidence.models import DocumentChunk
    from .gemini import GeminiUnavailable, embed_texts, is_configured

    query = (query or "").strip()
    if not query:
        return {"hits": [], "vector_used": False}
    hits: list[dict] = []
    seen: set[int] = set()
    vector_used = False

    if is_configured():
        try:
            vecs = embed_texts([query])
            if vecs and vecs[0]:
                vector_used = True
                hits.extend(_vector_hits(query, vecs[0], case_ids, limit, seen))
        except GeminiUnavailable as exc:
            log.info("vector retrieval skipped: %s", exc)

    if len(hits) < limit:
        hits.extend(_keyword_hits(query, case_ids, limit - len(hits), seen))
    return {"hits": hits[:limit], "vector_used": vector_used}


def _base_qs(case_ids):
    from apps.evidence.models import DocumentChunk
    qs = DocumentChunk.objects.select_related("evidence", "case").order_by("id")
    if case_ids is not None:
        qs = qs.filter(case_id__in=case_ids)
    return qs


def _hit(chunk, score: float, method: str) -> dict:
    return {
        "chunk_id": chunk.id, "evidence_id": chunk.evidence_id, "case_id": chunk.case_id,
        "file_name": chunk.evidence.file_name if chunk.evidence_id else "",
        "case_fir": chunk.case.fir_no if chunk.case_id else "",
        "text": chunk.text[:600], "score": round(float(score), 4), "method": method,
    }


def _vector_hits(query, vec, case_ids, limit, seen) -> list[dict]:
    from pgvector.django import CosineDistance
    qs = _base_qs(case_ids).filter(embedding__isnull=False)
    rows = (qs.annotate(distance=CosineDistance("embedding", vec))
            .order_by("distance")[:limit])
    out = []
    for chunk in rows:
        seen.add(chunk.id)
        out.append(_hit(chunk, 1.0 / (1.0 + float(chunk.distance)), "vector"))
    return out


def _keyword_hits(query, case_ids, limit, seen) -> list[dict]:
    if connection.vendor == "postgresql":
        return _pg_keyword_hits(query, case_ids, limit, seen)
    # Fallback (sqlite/dev): case-insensitive containment, term-coverage rank.
    terms = [t for t in query.lower().split() if len(t) > 2][:8]
    if not terms:
        return []
    from django.db.models import Q
    q = Q()
    for t in terms:
        q |= Q(text__icontains=t)
    out = []
    for chunk in _base_qs(case_ids).filter(q)[: limit * 3]:
        if chunk.id in seen:
            continue
        seen.add(chunk.id)
        lowered = chunk.text.lower()
        cover = sum(1 for t in terms if t in lowered) / len(terms)
        out.append(_hit(chunk, cover * 0.9, "keyword"))
    return sorted(out, key=lambda h: -h["score"])[:limit]


def _pg_keyword_hits(query, case_ids, limit, seen) -> list[dict]:
    from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
    vector = SearchVector("text", config="english")
    squery = SearchQuery(query, config="english", search_type="websearch")
    rows = (_base_qs(case_ids)
            .annotate(rank=SearchRank(vector, squery))
            .filter(rank__gt=0)
            .order_by("-rank")[: limit * 3])
    out = []
    for chunk in rows:
        if chunk.id in seen:
            continue
        seen.add(chunk.id)
        out.append(_hit(chunk, float(chunk.rank), "keyword"))
    return out[:limit]
