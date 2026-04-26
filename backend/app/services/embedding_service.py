import hashlib
import logging
from functools import lru_cache

from app.core.config import settings

logger = logging.getLogger("skillnote.embedding")


class EmbeddingNotConfigured(Exception):
    """Raised when SKILLNOTE_EMBEDDING_API_KEY is not set."""


class EmbeddingError(Exception):
    """Raised when the upstream embedding provider fails (rate limit, network, 5xx)."""


def is_configured() -> bool:
    return bool(settings.embedding_api_key)


def _ensure_configured() -> None:
    if not is_configured():
        raise EmbeddingNotConfigured(
            "SKILLNOTE_EMBEDDING_API_KEY is not set. Set it before calling embedding endpoints."
        )


@lru_cache(maxsize=1024)
def _embed_cached(text_hash: str, text: str) -> tuple[float, ...]:
    """Internal cached embed. Hash key stabilizes lookup; text passed for the actual call.

    Returns a tuple (hashable for lru_cache return value); callers convert to list.
    """
    return tuple(_embed_one(text))


def embed_text(text: str) -> list[float]:
    """Embed a single string. LRU-cached on SHA256 of input.

    Raises EmbeddingNotConfigured if no API key. Raises EmbeddingError on provider failure.
    """
    _ensure_configured()
    if not text:
        raise ValueError("embed_text requires non-empty text")
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return list(_embed_cached(h, text))


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed many strings in one provider call. Used by backfill.

    Returns vectors in input order. Raises EmbeddingNotConfigured / EmbeddingError.
    """
    _ensure_configured()
    if not texts:
        return []
    if any(not t for t in texts):
        raise ValueError("embed_batch requires all texts non-empty")
    return _embed_many(texts)


# ── provider dispatch ───────────────────────────────────────────────

def _embed_one(text: str) -> list[float]:
    return _embed_many([text])[0]


def _embed_many(texts: list[str]) -> list[list[float]]:
    if settings.embedding_provider == "openai":
        return _openai_embed(texts)
    if settings.embedding_provider == "voyage":
        return _voyage_embed(texts)
    raise EmbeddingError(f"Unknown embedding provider: {settings.embedding_provider!r}")


def _openai_embed(texts: list[str]) -> list[list[float]]:
    try:
        from openai import OpenAI, OpenAIError
    except ImportError as e:
        raise EmbeddingError(f"openai SDK not installed: {e}") from e
    client = OpenAI(api_key=settings.embedding_api_key)
    try:
        resp = client.embeddings.create(model=settings.embedding_model, input=texts)
    except OpenAIError as e:
        raise EmbeddingError(f"OpenAI embeddings call failed: {e}") from e
    vectors = [d.embedding for d in resp.data]
    if any(len(v) != settings.embedding_dim for v in vectors):
        raise EmbeddingError(
            f"OpenAI returned vectors of unexpected dimension; expected {settings.embedding_dim}"
        )
    return vectors


def _voyage_embed(texts: list[str]) -> list[list[float]]:
    try:
        import voyageai
    except ImportError as e:
        raise EmbeddingError(f"voyageai SDK not installed: {e}") from e
    client = voyageai.Client(api_key=settings.embedding_api_key)
    try:
        result = client.embed(texts, model=settings.embedding_model)
    except Exception as e:  # voyageai doesn't have a stable error class
        raise EmbeddingError(f"Voyage embeddings call failed: {e}") from e
    vectors = result.embeddings
    if any(len(v) != settings.embedding_dim for v in vectors):
        raise EmbeddingError(
            f"Voyage returned vectors of unexpected dimension; expected {settings.embedding_dim}"
        )
    return vectors


# ── helper for callers that need to embed a Skill ─────────────────────

def skill_embedding_text(name: str, description: str | None) -> str:
    """Build the canonical string we embed for a skill: name + blank line + description."""
    return f"{name}\n\n{description or ''}".strip()
