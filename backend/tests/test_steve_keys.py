"""A reader's own Gemini key (C20.3): checked with Google, encrypted at rest, never returned or logged.

GET/PUT/DELETE /steve/key, backend/steve/keys.py, provider.check_key and the service using the stored key.
Google is faked; nothing leaves the machine.
"""

import asyncio
import logging

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import auth
from backend.routers import steve as steve_router
from backend.steve import keys, provider, service
from backend.steve.errors import SteveUnavailable
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
KEY = "AIzaSyReaderOwnKey-not-real-abcdefghij12"
BAD_KEY = "AIzaSyRevokedKey-not-real-zyxwvutsrq9876"
SECRET = "test-secret-not-real-0123456789-abcdefghijklmnopqrstuvwxyz"


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["profiles"] = [
        {"user_id": USER, "steve_enabled": True, "steve_key_cipher": None, "steve_key_last4": None},
        {"user_id": OTHER, "steve_enabled": True, "steve_key_cipher": None, "steve_key_last4": None},
    ]
    monkeypatch.setattr(keys, "supabase", db)
    monkeypatch.setattr(steve_router, "supabase", db)
    monkeypatch.setattr(auth, "supabase", db)
    monkeypatch.setenv("KEY_ENCRYPTION_SECRET", SECRET)
    return db


@pytest.fixture
def google(monkeypatch):
    """provider.check_key: accepts KEY, rejects anything else; can be made busy."""
    state = {"checked": [], "busy": None}

    async def check_key(api_key):
        state["checked"].append(api_key)
        if state["busy"]:
            raise SteveUnavailable(state["busy"])
        if api_key != KEY:
            raise SteveUnavailable("key_rejected")

    monkeypatch.setattr(provider, "check_key", check_key)
    return state


@pytest.fixture
def client(db, google):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def mine(db):
    return next(row for row in db.tables["profiles"] if row["user_id"] == USER)


def test_a_new_reader_has_no_key(client):
    assert client.get("/steve/key").json() == {"has_key": False, "last4": None}


def test_a_good_key_is_checked_encrypted_and_stored_with_its_last_four(client, db, google):
    response = client.put("/steve/key", json={"key": f"  {KEY}\n"})
    assert response.status_code == 200 and response.json() == {"has_key": True, "last4": "ij12"}
    assert google["checked"] == [KEY]
    row = mine(db)
    assert row["steve_key_last4"] == "ij12" and row["steve_key_cipher"]
    assert KEY not in row["steve_key_cipher"] and keys.decrypt(row["steve_key_cipher"]) == KEY
    assert client.get("/steve/key").json() == {"has_key": True, "last4": "ij12"}


def test_a_key_google_rejects_is_refused_and_nothing_is_stored(client, db):
    response = client.put("/steve/key", json={"key": BAD_KEY})
    assert response.status_code == 400 and "did not accept" in response.json()["detail"]
    assert mine(db)["steve_key_cipher"] is None


@pytest.mark.parametrize("body", [{"key": "short"}, {"key": "has spaces inside it but is long enough"}, {"key": 42},
                                  {"api_key": KEY}, {}, [KEY], {"key": KEY, "extra": KEY}])
def test_a_malformed_request_is_refused_without_calling_google_or_echoing_the_key(client, db, google, body):
    response = client.put("/steve/key", json=body)
    assert response.status_code == 422 and KEY not in response.text
    assert google["checked"] == [] and mine(db)["steve_key_cipher"] is None


def test_a_body_that_is_not_json_is_refused(client, google):
    response = client.put("/steve/key", content=f"key={KEY}", headers={"Content-Type": "application/json"})
    assert response.status_code == 422 and KEY not in response.text and google["checked"] == []


@pytest.mark.parametrize("reason", ["paused_quota", "timeout", "unavailable", "not_configured"])
def test_when_google_cannot_check_the_key_nothing_is_stored(client, db, google, reason):
    google["busy"] = reason
    response = client.put("/steve/key", json={"key": KEY})
    assert response.status_code == 503 and KEY not in response.text
    assert mine(db)["steve_key_cipher"] is None


def test_delete_removes_the_key(client, db):
    client.put("/steve/key", json={"key": KEY})
    response = client.delete("/steve/key")
    assert response.status_code == 200 and response.json() == {"has_key": False, "last4": None}
    assert mine(db)["steve_key_cipher"] is None and mine(db)["steve_key_last4"] is None
    assert client.delete("/steve/key").status_code == 200  # deleting nothing is fine


def test_only_the_callers_key_changes(client, db):
    client.put("/steve/key", json={"key": KEY})
    other = next(row for row in db.tables["profiles"] if row["user_id"] == OTHER)
    assert other["steve_key_cipher"] is None


def test_no_secret_on_the_server_means_no_own_keys(client, db, monkeypatch):
    monkeypatch.delenv("KEY_ENCRYPTION_SECRET")
    response = client.put("/steve/key", json={"key": KEY})
    assert response.status_code == 503 and mine(db)["steve_key_cipher"] is None


def test_the_key_never_appears_in_a_response_or_a_log_line(client, db, caplog):
    caplog.set_level(logging.DEBUG)
    bodies = [
        client.put("/steve/key", json={"key": KEY}).text,
        client.get("/steve/key").text,
        client.get("/steve/settings").text,
        client.get("/auth/profile").text,
        client.put("/steve/key", json={"key": BAD_KEY}).text,
        client.put("/steve/key", json={"key": KEY, "oops": True}).text,
        client.delete("/steve/key").text,
    ]
    for text in [*bodies, caplog.text]:
        assert KEY not in text and BAD_KEY not in text
        assert "steve_key_cipher" not in text


def test_a_cipher_made_with_another_secret_reads_as_no_usable_key(db, monkeypatch):
    mine(db)["steve_key_cipher"] = keys.encrypt(KEY)
    monkeypatch.setenv("KEY_ENCRYPTION_SECRET", "a-different-secret-after-rotation-0123456789")
    with pytest.raises(SteveUnavailable) as caught:
        keys.reader_key(USER)
    assert caught.value.reason == "key_rejected" and KEY not in repr(caught.value)


def test_encryption_is_not_deterministic_and_round_trips():
    assert keys.encrypt(KEY) != keys.encrypt(KEY)
    assert keys.decrypt(keys.encrypt(KEY)) == KEY
    assert keys.last4(KEY) == "ij12"


def test_the_service_answers_on_the_readers_stored_key(db, monkeypatch):
    mine(db)["steve_key_cipher"], mine(db)["steve_key_last4"] = keys.encrypt(KEY), "ij12"
    used = []

    async def generate(parts, *, model="chat", api_key=None, stream=False, system=None):
        used.append(api_key)
        yield provider.Piece(text="ok", done=True, model="m")

    monkeypatch.setattr(provider, "generate", generate)
    monkeypatch.setattr(provider, "model_name", lambda role: "m")

    def no_quota(*args, **kwargs):
        raise AssertionError("an own key is never counted")

    monkeypatch.setattr(service.quota, "take", no_quota)

    async def run():
        return [p async for p in service.ask(user_id=USER, book_id="b", question="q", context_hash="c", parts=["q"])]

    assert asyncio.run(run())[0].text == "ok" and used == [KEY]
