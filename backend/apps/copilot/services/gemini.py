"""Gemini API boundary (Phase 6): embeddings + grounded generation.

Key-optional by design: without GEMINI_API_KEY every caller degrades to
keyword retrieval + extractive answers (honestly labeled `generated: false`).
No fake vectors, no fake prose — ever. Uses the `google-genai` SDK.
"""
from __future__ import annotations

import logging

from django.conf import settings

log = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-004"
EMBED_DIMS = 768


class GeminiUnavailable(RuntimeError):
    """No key configured, or the API call failed."""


def is_configured() -> bool:
    return bool(getattr(settings, "GEMINI_API_KEY", ""))


def _client():
    key = getattr(settings, "GEMINI_API_KEY", "")
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY is not configured")
    try:
        from google import genai
    except ImportError as exc:
        raise GeminiUnavailable("google-genai package not installed") from exc
    return genai.Client(api_key=key)


def embed_texts(texts: list[str]) -> list[list[float] | None]:
    """Embed a batch; per-item None on failure (caller counts embedded)."""
    client = _client()  # raises when unconfigured — caller degrades to keyword-only
    out: list[list[float] | None] = []
    for i in range(0, len(texts), 16):
        batch = texts[i:i + 16]
        try:
            resp = client.models.embed_content(model=EMBED_MODEL, contents=batch)
            out.extend([list(e.values) for e in resp.embeddings])
        except Exception as exc:
            log.warning("gemini embed batch failed (%d items): %s", len(batch), exc)
            out.extend([None] * len(batch))
    return out


def generate(prompt: str) -> str:
    """Grounded generation; raises GeminiUnavailable on any failure."""
    client = _client()
    model = getattr(settings, "GEMINI_MODEL", "gemini-2.0-flash")
    try:
        resp = client.models.generate_content(model=model, contents=prompt)
        text = (resp.text or "").strip()
        if not text:
            raise GeminiUnavailable("empty generation response")
        return text
    except GeminiUnavailable:
        raise
    except Exception as exc:
        raise GeminiUnavailable(f"generation failed: {exc}") from exc
