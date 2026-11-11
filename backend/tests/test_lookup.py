"""Word and phrase lookup (C12.6): Free Dictionary, then Wikipedia, behind a shared cache.

All HTTP goes through httpx.MockTransport and the cache table through the
in-memory database: nothing leaves the machine.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.services import lookup
from backend.tests.memory_db import MemoryDb

USER = "user-1"
DICT = "https://api.dictionaryapi.dev/api/v2/entries/en/"
WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary/"

RUN = [{
    "word": "run", "phonetic": "/ɹʌn/",
    "phonetics": [{"text": "/ɹʌn/", "audio": ""}, {"audio": "https://audio.test/run.mp3"}],
    "meanings": [
        {"partOfSpeech": "verb", "definitions": [
            {"definition": "To move swiftly.", "example": "Run to the shop."},
            {"definition": "To flee."}, {"definition": "To operate."}]},
        {"partOfSpeech": "noun", "definitions": [{"definition": "An act of running."}]},
        {"partOfSpeech": "adjective", "definitions": [{"definition": "Melted."}]},
        {"partOfSpeech": "interjection", "definitions": [{"definition": "Flee!"}]},
    ],
}]
THOREAU = {
    "type": "standard", "title": "Henry David Thoreau",
    "extract": "Henry David Thoreau was an American naturalist. He wrote Walden. He died in 1862.",
    "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Henry_David_Thoreau"}},
    "thumbnail": {"source": "https://upload.test/thoreau.jpg"},
}
MERCURY = {"type": "disambiguation", "title": "Mercury", "extract": "Mercury may refer to:",
           "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Mercury"}}}


class Upstream:
    """Answers by URL; records every request."""

    def __init__(self, routes):
        self.routes, self.requests = routes, []

    def __call__(self, request):
        self.requests.append(request)
        answer = self.routes.get(str(request.url))
        if answer is None:
            return httpx.Response(404, json={"title": "No Definitions Found"})
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(200, json=answer)

    @property
    def urls(self):
        return [str(r.url) for r in self.requests]


@pytest.fixture
def env(monkeypatch):
    db = MemoryDb()
    upstream = Upstream({})
    clock = SimpleNamespace(now=datetime(2026, 11, 11, 12, tzinfo=UTC))
    monkeypatch.setattr(lookup, "supabase", db)
    monkeypatch.setattr(lookup, "_http", httpx.Client(transport=httpx.MockTransport(upstream),
                                                      headers={"User-Agent": lookup.USER_AGENT}))
    monkeypatch.setattr(lookup, "_now", lambda: clock.now)
    lookup.reset()
    app.dependency_overrides[get_current_user] = lambda: USER
    with TestClient(app) as client:
        yield SimpleNamespace(db=db, upstream=upstream, clock=clock, client=client)
    app.dependency_overrides.clear()
    lookup.reset()


def get(env, term, **params):
    return env.client.get("/lookup", params={"term": term, **params})


@pytest.mark.parametrize("raw, key", [
    ("  Running, ", "running"), ("“Walden Pond.”", "walden pond"), ("self-reliance!", "self-reliance"),
    ("don't", "don't"),
])
def test_normalize_trims_strips_punctuation_and_lowercases(raw, key):
    assert lookup.normalize(raw).key == key


def test_normalize_keeps_the_original_casing():
    assert lookup.normalize(" Walden Pond, ").display == "Walden Pond"


@pytest.mark.parametrize("raw", ["", "   ", "1862", "3.14", "...", "one two three four five six", "x" * 61])
def test_normalize_rejects_numbers_long_phrases_and_empty_terms(raw):
    assert lookup.normalize(raw) is None


def test_base_forms_are_simple_and_few():
    assert lookup.base_forms("berries")[0] == "berry"
    assert "box" in lookup.base_forms("boxes")
    assert "walk" in lookup.base_forms("walked") and "walk" in lookup.base_forms("walking")
    assert lookup.base_forms("cat") == []
    assert all(len(lookup.base_forms(w)) <= lookup.MAX_BASE_FORMS for w in ("ties", "boxes", "baked", "running"))


def test_dictionary_hit_gives_a_compact_payload(env):
    env.upstream.routes[DICT + "run"] = RUN
    body = get(env, "Run").json()
    assert body["found"] is True and body["source"] == "dictionary" and body["term"] == "run"
    assert body["phonetic"] == "/ɹʌn/" and body["audio_url"] == "https://audio.test/run.mp3"
    assert [m["part_of_speech"] for m in body["meanings"]] == ["verb", "noun", "adjective"]
    assert body["meanings"][0]["definitions"] == ["To move swiftly.", "To flee."]
    assert body["meanings"][0]["example"] == "Run to the shop."
    assert body["wiki"] is None
    assert env.upstream.urls == [DICT + "run"]
    assert env.upstream.requests[0].headers["User-Agent"] == lookup.USER_AGENT
    assert "ReadFocus" in lookup.USER_AGENT and "github.com" in lookup.USER_AGENT


def test_a_miss_retries_simple_base_forms(env):
    env.upstream.routes[DICT + "run"] = RUN
    body = get(env, "runs").json()
    assert body["found"] is True and body["meanings"][0]["part_of_speech"] == "verb"
    assert env.upstream.urls[:2] == [DICT + "runs", DICT + "run"]


def test_a_dictionary_miss_falls_back_to_wikipedia(env):
    env.upstream.routes[WIKI + "Thoreauvian"] = dict(THOREAU, title="Thoreauvian")
    body = get(env, "thoreauvian").json()
    assert body["found"] is True and body["source"] == "wikipedia"
    assert body["wiki"]["extract"] == "Henry David Thoreau was an American naturalist. He wrote Walden."


def test_a_proper_noun_goes_to_wikipedia_first(env):
    env.upstream.routes[WIKI + "Henry_David_Thoreau"] = THOREAU
    body = get(env, "Henry David Thoreau", proper=1).json()
    assert env.upstream.urls == [WIKI + "Henry_David_Thoreau"]
    assert body["wiki"] == {
        "title": "Henry David Thoreau",
        "extract": "Henry David Thoreau was an American naturalist. He wrote Walden.",
        "url": "https://en.wikipedia.org/wiki/Henry_David_Thoreau",
        "thumbnail_url": "https://upload.test/thoreau.jpg",
    }


def test_a_phrase_goes_to_wikipedia_without_the_dictionary(env):
    env.upstream.routes[WIKI + "Walden_Pond"] = dict(THOREAU, title="Walden Pond")
    assert get(env, "Walden Pond").json()["source"] == "wikipedia"
    assert all(url.startswith(WIKI) for url in env.upstream.urls)


def test_a_disambiguation_page_is_reported_as_ambiguous(env):
    env.upstream.routes[WIKI + "Mercury"] = MERCURY
    body = get(env, "Mercury", proper=1).json()
    assert body["ambiguous"] is True and body["url"] == "https://en.wikipedia.org/wiki/Mercury"


def test_a_timeout_is_graceful_and_not_cached(env):
    env.upstream.routes[DICT + "slow"] = httpx.ReadTimeout("slow")
    response = get(env, "slow")
    assert response.status_code == 200
    body = response.json()
    assert body["found"] is False and body["unavailable"] is True
    assert "couldn't look this up" in body["message"].lower()
    assert env.upstream.urls == [DICT + "slow"]  # no base forms, no Wikipedia: no retry storm
    assert env.db.tables.get("term_lookups", []) == []
    assert lookup.TIMEOUT_SECONDS == 2.5


def test_a_cache_hit_makes_no_request(env):
    env.upstream.routes[DICT + "run"] = RUN
    first = get(env, "run").json()
    lookup.reset()  # drop the in-process copy: the shared table must answer
    env.upstream.requests.clear()
    assert get(env, "run").json() == first
    assert env.upstream.requests == []
    (row,) = env.db.tables["term_lookups"]
    assert (row["term"], row["lang"], row["found"], row["source"]) == ("run", "en", True, "dictionary")


def test_a_positive_entry_expires_after_90_days(env):
    env.upstream.routes[DICT + "run"] = RUN
    get(env, "run")
    lookup.reset()
    env.clock.now += timedelta(days=89)
    get(env, "run")
    assert len(env.upstream.requests) == 1
    env.clock.now += timedelta(days=2)
    get(env, "run")
    assert len(env.upstream.requests) == 2


def test_not_found_is_cached_for_7_days(env):
    body = get(env, "zzxq").json()
    assert body["found"] is False and not body.get("unavailable")
    count = len(env.upstream.requests)
    lookup.reset()
    env.clock.now += timedelta(days=6)
    get(env, "zzxq")
    assert len(env.upstream.requests) == count
    env.clock.now += timedelta(days=2)
    get(env, "zzxq")
    assert len(env.upstream.requests) == 2 * count


def test_a_broken_cache_table_still_looks_the_word_up(env):
    env.db.broken.add("term_lookups")
    env.upstream.routes[DICT + "run"] = RUN
    assert get(env, "run").json()["found"] is True


def test_the_per_user_rate_limit_answers_a_friendly_429(env):
    env.upstream.routes[DICT + "run"] = RUN
    for _ in range(lookup.RATE_LIMIT):
        assert get(env, "run").status_code == 200
    refused = get(env, "run")
    assert refused.status_code == 429
    assert int(refused.headers["Retry-After"]) > 0
    assert "moment" in refused.json()["detail"]
    env.clock.now += timedelta(seconds=61)
    assert get(env, "run").status_code == 200


def test_a_term_that_is_not_a_word_is_422(env):
    assert get(env, "1862").status_code == 422
    assert get(env, "run", lang="fr").status_code == 422
    assert env.upstream.requests == []


def test_lookup_needs_a_signed_in_user():
    assert TestClient(app).get("/lookup", params={"term": "run"}).status_code in (401, 403)
