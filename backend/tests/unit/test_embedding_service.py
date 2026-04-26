"""Unit tests for the embedding service.

Tests use monkeypatched providers — never hit the real OpenAI/Voyage APIs.
"""
import pytest

from app.services import embedding_service
from app.services.embedding_service import (
    EmbeddingError,
    EmbeddingNotConfigured,
    embed_batch,
    embed_text,
    skill_embedding_text,
)


@pytest.fixture(autouse=True)
def _clear_embedding_cache():
    """LRU cache is module-global; clear before/after each test to avoid bleed."""
    embedding_service._embed_cached.cache_clear()
    yield
    embedding_service._embed_cached.cache_clear()


@pytest.fixture
def configured(monkeypatch):
    """Provide a fake API key so _ensure_configured() passes."""
    monkeypatch.setattr(embedding_service.settings, "embedding_api_key", "test-key")
    monkeypatch.setattr(embedding_service.settings, "embedding_provider", "openai")
    monkeypatch.setattr(embedding_service.settings, "embedding_dim", 1536)
    return monkeypatch


def test_not_configured_raises(monkeypatch):
    monkeypatch.setattr(embedding_service.settings, "embedding_api_key", None)
    with pytest.raises(EmbeddingNotConfigured):
        embed_text("anything")


def test_embed_text_happy_path(configured):
    configured.setattr(
        embedding_service,
        "_embed_many",
        lambda texts: [[0.1] * 1536 for _ in texts],
    )
    result = embed_text("hello")
    assert isinstance(result, list)
    assert len(result) == 1536
    assert result[0] == 0.1


def test_embed_batch_happy_path(configured):
    expected = [[float(i)] * 1536 for i in range(5)]
    configured.setattr(embedding_service, "_embed_many", lambda texts: expected)
    result = embed_batch(["a", "b", "c", "d", "e"])
    assert len(result) == 5
    for i, vec in enumerate(result):
        assert vec[0] == float(i)


def test_embed_text_caches_on_identical_input(configured):
    call_count = {"n": 0}

    def fake_embed_one(text: str) -> list[float]:
        call_count["n"] += 1
        return [0.42] * 1536

    configured.setattr(embedding_service, "_embed_one", fake_embed_one)

    embed_text("same")
    embed_text("same")
    embed_text("same")
    assert call_count["n"] == 1


def test_empty_text_raises(configured):
    with pytest.raises(ValueError):
        embed_text("")
    assert embed_batch([]) == []
    with pytest.raises(ValueError):
        embed_batch(["", "x"])


def test_unknown_provider_raises(configured):
    configured.setattr(embedding_service.settings, "embedding_provider", "fake")
    with pytest.raises(EmbeddingError, match="Unknown embedding provider"):
        embed_text("x")


def test_skill_embedding_text():
    assert skill_embedding_text("my-skill", "does X") == "my-skill\n\ndoes X"
    assert skill_embedding_text("my-skill", None) == "my-skill"


# ── direct provider tests (stub the SDK clients) ──────────────────────

class _FakeEmbeddingResp:
    def __init__(self, vectors):
        self.data = [type("D", (), {"embedding": v})() for v in vectors]


class _FakeEmbeddings:
    def __init__(self, vectors):
        self._v = vectors

    def create(self, model, input):
        return _FakeEmbeddingResp(self._v)


def _make_fake_openai(vectors):
    class _FakeOpenAI:
        def __init__(self, api_key):
            self.embeddings = _FakeEmbeddings(vectors)

    return _FakeOpenAI


def test_openai_embed_dimension_guard_raises_on_mismatch(configured, monkeypatch):
    # Returned vector is 100-dim but settings.embedding_dim is 1536.
    monkeypatch.setattr("openai.OpenAI", _make_fake_openai([[0.0] * 100]))
    with pytest.raises(EmbeddingError, match="dimension"):
        embedding_service._openai_embed(["x"])


def test_openai_embed_happy_path_correct_dim(configured, monkeypatch):
    vectors = [[0.1] * 1536, [0.2] * 1536]
    monkeypatch.setattr("openai.OpenAI", _make_fake_openai(vectors))
    result = embedding_service._openai_embed(["a", "b"])
    assert len(result) == 2
    assert all(len(v) == 1536 for v in result)


# TODO(v2.1): add direct test for _voyage_embed
