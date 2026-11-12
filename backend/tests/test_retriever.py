"""backend.services.retriever: hybrid search on a mocked database.

The Supabase client is the shared fake from conftest.py and the embedder
is replaced, so nothing here needs the network or the model. The check
against the dev database is scripts/dev/check_retriever.py, run by hand.
"""

import asyncio
import inspect
from unittest.mock import MagicMock

import numpy as np
import pytest

from backend.nlp import embedder
from backend.services import retriever


def row(chunk_index: int, content: str = "") -> dict:
    return {"id": f"id-{chunk_index}", "chunk_index": chunk_index, "content": content or f"chunk {chunk_index}"}


@pytest.fixture
def db(fake_supabase, monkeypatch):
    """Canned rows per database function; records every call."""
    state = {"rows": {"match_chunks_local": [], "search_chunks_text": []}, "calls": [], "fail": set()}

    def rpc(name, params):
        state["calls"].append((name, params))
        if name in state["fail"]:
            raise RuntimeError(f"{name} is down")
        result = MagicMock()
        result.execute.return_value.data = state["rows"][name]
        return result

    fake_supabase.rpc.side_effect = rpc
    monkeypatch.setattr(embedder, "embed_one", lambda text: np.full(embedder.EMBEDDING_DIM, 0.05, dtype=np.float32))
    yield state
    fake_supabase.rpc.side_effect = None


def test_rrf_puts_a_row_found_by_both_searches_first():
    fused = retriever.rrf_fuse([[row(1), row(2), row(3)], [row(9), row(2)]])
    assert [r["chunk_index"] for r in fused] == [2, 1, 9, 3]
    assert fused[0]["score"] == pytest.approx(1 / 62 + 1 / 62)
    assert fused[1]["score"] == pytest.approx(1 / 61)


def test_rrf_breaks_ties_by_chunk_index_and_keeps_one_row_per_id():
    fused = retriever.rrf_fuse([[row(7)], [row(4)], [row(7)]])
    assert [r["chunk_index"] for r in fused] == [7, 4]
    fused = retriever.rrf_fuse([[row(7)], [row(4)]])
    assert [r["chunk_index"] for r in fused] == [4, 7]
    assert retriever.rrf_fuse([[], []]) == []


@pytest.mark.parametrize("query,expected", [
    ("What converts light energy?", "converts or light or energy"),
    ("the energy of the light, the energy", "energy or light"),
    ("Is it the one?", "one"),
    ("of the and", ""),
    ("", ""),
])
def test_text_query_is_an_or_of_content_words(query, expected):
    assert retriever.text_query(query) == expected


def test_text_query_keeps_the_most_frequent_words_of_a_long_passage():
    passage = "antenna " * 5 + "patch " * 3 + " ".join(f"word{i}" for i in range(40))
    terms = retriever.text_query(passage).split(" or ")
    assert len(terms) == retriever.MAX_QUERY_TERMS
    assert terms[:2] == ["antenna", "patch"]


def test_search_calls_both_functions_and_fuses(db):
    db["rows"]["match_chunks_local"] = [row(1), row(2)]
    db["rows"]["search_chunks_text"] = [row(2), row(5)]
    found = asyncio.run(retriever.search("light energy in plants", "book-1", k=2))
    assert [r["chunk_index"] for r in found] == [2, 1]
    calls = dict(db["calls"])
    vector_call = calls["match_chunks_local"]
    assert len(vector_call["query_embedding"]) == embedder.EMBEDDING_DIM
    assert all(isinstance(value, float) for value in vector_call["query_embedding"])
    assert (vector_call["match_count"], vector_call["p_book_id"]) == (retriever.CANDIDATES, "book-1")
    assert calls["search_chunks_text"] == {
        "query_text": "light or energy or plants", "match_count": retriever.CANDIDATES, "p_book_id": "book-1",
    }


def test_search_survives_one_search_failing(db):
    db["rows"]["match_chunks_local"] = [row(1)]
    db["rows"]["search_chunks_text"] = [row(5)]
    db["fail"] = {"match_chunks_local"}
    assert [r["chunk_index"] for r in asyncio.run(retriever.search("light energy", "b"))] == [5]
    db["fail"] = {"search_chunks_text"}
    assert [r["chunk_index"] for r in asyncio.run(retriever.search("light energy", "b"))] == [1]


def test_search_survives_the_embedder_failing(db, monkeypatch):
    def broken(text):
        raise RuntimeError("model missing")

    monkeypatch.setattr(embedder, "embed_one", broken)
    db["rows"]["search_chunks_text"] = [row(5)]
    assert [r["chunk_index"] for r in asyncio.run(retriever.search("light energy", "b"))] == [5]
    assert [name for name, _ in db["calls"]] == ["search_chunks_text"]


def test_search_skips_the_text_search_when_the_query_has_no_content_words(db):
    db["rows"]["match_chunks_local"] = [row(1)]
    assert [r["chunk_index"] for r in asyncio.run(retriever.search("is it the", "b"))] == [1]
    assert [name for name, _ in db["calls"]] == ["match_chunks_local"]


def test_search_of_nothing_calls_nothing(db):
    assert asyncio.run(retriever.search("   ", "b")) == []
    assert db["calls"] == []


def test_get_similar_chunks_keeps_its_signature_and_returns_content(db):
    signature = inspect.signature(retriever.get_similar_chunks)
    assert list(signature.parameters) == ["query_text", "book_id", "k"]
    assert signature.parameters["k"].default == 3
    assert inspect.iscoroutinefunction(retriever.get_similar_chunks)
    db["rows"]["match_chunks_local"] = [row(1, "first"), row(2, "second"), row(3, "third"), row(4, "fourth")]
    assert asyncio.run(retriever.get_similar_chunks("light energy", "b")) == ["first", "second", "third"]
    assert asyncio.run(retriever.get_similar_chunks("light energy", "b", k=1)) == ["first"]


def test_the_module_no_longer_uses_langchain_or_the_google_client():
    source = inspect.getsource(retriever)
    assert "langchain" not in source
    assert "services.embeddings" not in source
    assert "match_chunks\"" not in source and "match_chunks'" not in source
