"""Chunking for RAG indexing: sentence-aware greedy packing.

~800 chars per chunk with ~100 chars of overlap so relations spanning a
boundary stay retrievable. Deterministic and dependency-free.
"""
from __future__ import annotations

import re

CHUNK_CHARS = 800
OVERLAP_CHARS = 100

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def chunk_text(text: str, chunk_chars: int = CHUNK_CHARS,
               overlap_chars: int = OVERLAP_CHARS) -> list[str]:
    """Split text into overlapping chunks. Returns [] for blank input."""
    sentences = [s.strip() for s in _SENT_SPLIT.split(text or "") if s.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for sent in sentences:
        if current and current_len + len(sent) + 1 > chunk_chars:
            chunks.append(" ".join(current))
            # overlap: carry the tail of the flushed chunk forward
            tail = chunks[-1][-overlap_chars:]
            current, current_len = [tail], len(tail)
        current.append(sent)
        current_len += len(sent) + 1
    if current:
        joined = " ".join(current).strip()
        if joined:
            chunks.append(joined)
    # A single over-long sentence still becomes exactly one chunk.
    if not chunks and (text or "").strip():
        chunks = [(text or "").strip()[:chunk_chars]]
    return chunks
