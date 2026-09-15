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

# Generation model fallback chain. Google retires Flash generations
# regularly (2.0-flash went 404 in production) — a single hardcoded default
# turns a routine sunset into a full copilot outage. The configured
# GEMINI_MODEL is always tried first; retired-model 404s walk the chain.
# Order: current stable → previous stable → newest GA (may need thinking
# config, so last — temperature-only callers degrade first).
GENERATION_FALLBACKS = (
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
)

DEFAULT_GENERATION_MODEL = "gemini-2.5-flash"


def _candidate_models() -> list[str]:
    from django.conf import settings

    first = (getattr(settings, "GEMINI_MODEL", "") or "").strip() or DEFAULT_GENERATION_MODEL
    out = [first]
    for m in GENERATION_FALLBACKS:
        if m not in out:
            out.append(m)
    return out


def _looks_like_retired_model(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "404" in msg
        or "not_found" in msg
        or "not found" in msg
        or "no longer available" in msg
        or "unsupported model" in msg
        or "model not" in msg
    )


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


def generate(prompt: str, temperature: float | None = None) -> str:
    """Grounded generation; raises GeminiUnavailable on any failure.

    `temperature` is None by default (existing callers unchanged); the
    NL-to-Cypher path passes 0.0 for deterministic output.

    Retired-model 404s automatically walk GENERATION_FALLBACKS (first
    configured model wins, so GEMINI_MODEL stays authoritative). Newer
    thinking models that reject `temperature` are retried once without it.
    """
    client = _client()
    try:
        from google.genai import types as _genai_types
    except ImportError:
        _genai_types = None
    last_exc: Exception | None = None
    for model in _candidate_models():
        try:
            # Sampling config is built once per call (not per model); SDKs
            # without `types` (or thinking models that reject temperature)
            # fall back to a bare call.
            kwargs: dict = {}
            if temperature is not None and _genai_types is not None:
                kwargs["config"] = _genai_types.GenerateContentConfig(temperature=temperature)
            try:
                resp = client.models.generate_content(model=model, contents=prompt, **kwargs)
            except Exception as inner:
                # Thinking-generation models (Gemini 3.x) may reject the
                # sampling config — retry the same model bare before moving on.
                if kwargs and "temperature" in str(inner).lower():
                    resp = client.models.generate_content(model=model, contents=prompt)
                else:
                    raise
            text = (resp.text or "").strip()
            if not text:
                raise GeminiUnavailable("empty generation response")
            if model != _candidate_models()[0]:
                log.warning("gemini model %s failed over; serving from %s", _candidate_models()[0], model)
            return text
        except GeminiUnavailable:
            raise
        except Exception as exc:
            last_exc = exc
            if _looks_like_retired_model(exc):
                log.warning("gemini model %s unavailable (%s); trying fallback", model, exc)
                continue
            raise GeminiUnavailable(f"generation failed: {exc}") from exc
    raise GeminiUnavailable(f"generation failed: {last_exc}") from last_exc
