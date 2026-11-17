"""GET and PUT /steve/settings (C20.1): Steve's off switch and the reader's consent, with the notice version stored."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import auth, steve
from backend.steve import consent
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
STEVE_MD = Path(__file__).resolve().parents[2] / "docs" / "STEVE.md"


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["profiles"] = [
        {"user_id": USER, "display_name": "Ada", "steve_enabled": True, "steve_consent_at": None,
         "steve_consent_version": None, "steve_key_cipher": None, "steve_key_last4": None},
        {"user_id": OTHER, "display_name": "Bo", "steve_enabled": True, "steve_consent_at": "2026-11-01T00:00:00+00:00",
         "steve_consent_version": consent.CONSENT_VERSION, "steve_key_cipher": "gAAAA-other", "steve_key_last4": "9xQz"},
    ]
    monkeypatch.setattr(steve, "supabase", db)
    monkeypatch.setattr(auth, "supabase", db)
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def mine(db):
    return next(row for row in db.tables["profiles"] if row["user_id"] == USER)


def put(client, body):
    return client.put("/steve/settings", json=body)


def test_a_new_reader_has_steve_on_but_no_consent_and_gets_the_current_notice(client):
    body = client.get("/steve/settings").json()
    assert body["enabled"] is True
    assert body["consent"] == {"given": False, "at": None, "version": None, "current": False}
    assert body["notice"] == {"version": consent.CONSENT_VERSION, "text": consent.CONSENT_TEXT,
                              "terms_url": consent.TERMS_URL}


def test_consent_to_the_current_notice_is_stored_with_its_version(client, db):
    response = put(client, {"consent": True, "consent_version": consent.CONSENT_VERSION})
    assert response.status_code == 200
    row = mine(db)
    assert row["steve_consent_at"] and row["steve_consent_version"] == consent.CONSENT_VERSION
    assert response.json()["consent"] == {"given": True, "at": row["steve_consent_at"],
                                          "version": consent.CONSENT_VERSION, "current": True}


@pytest.mark.parametrize("body", [
    {"consent": True},                                   # no version: the reader may not have seen this text
    {"consent": True, "consent_version": "2000-01-01"},  # an older or made-up notice
])
def test_consent_to_anything_but_the_current_notice_is_refused(client, db, body):
    assert put(client, body).status_code == 409
    assert mine(db)["steve_consent_at"] is None


def test_consent_to_an_older_notice_is_not_current(client, db):
    mine(db).update(steve_consent_at="2026-10-01T00:00:00+00:00", steve_consent_version="2026-10-01")
    assert client.get("/steve/settings").json()["consent"]["current"] is False


def test_withdrawing_consent_clears_the_time_and_version(client, db):
    put(client, {"consent": True, "consent_version": consent.CONSENT_VERSION})
    response = put(client, {"consent": False})
    assert response.status_code == 200
    assert mine(db)["steve_consent_at"] is None and mine(db)["steve_consent_version"] is None
    assert response.json()["consent"]["given"] is False


def test_turning_steve_off_and_on_keeps_consent(client, db):
    put(client, {"consent": True, "consent_version": consent.CONSENT_VERSION})
    assert put(client, {"enabled": False}).json()["enabled"] is False
    assert mine(db)["steve_enabled"] is False and mine(db)["steve_consent_at"]
    assert put(client, {"enabled": True}).json()["enabled"] is True


@pytest.mark.parametrize("body", [{}, {"enabled": "maybe"}, {"steve_key_cipher": "x"}, {"user_id": OTHER}])
def test_an_empty_or_unknown_update_is_refused(client, db, body):
    before = [dict(row) for row in db.tables["profiles"]]
    assert put(client, body).status_code == 422
    assert db.tables["profiles"] == before


def test_only_the_callers_profile_changes(client, db):
    put(client, {"enabled": False})
    other = next(row for row in db.tables["profiles"] if row["user_id"] == OTHER)
    assert other["steve_enabled"] is True


def test_no_profile_is_a_404(client, db):
    db.tables["profiles"] = []
    assert client.get("/steve/settings").status_code == 404
    assert put(client, {"enabled": False}).status_code == 404


def test_settings_never_carry_the_key_cipher(client, db):
    mine(db).update(steve_key_cipher="gAAAA-secret-cipher", steve_key_last4="AbCd")
    text = client.get("/steve/settings").text + put(client, {"enabled": False}).text
    assert "gAAAA-secret-cipher" not in text


def test_the_profile_route_never_returns_the_key_cipher(client, db):
    mine(db).update(steve_key_cipher="gAAAA-secret-cipher")
    body = client.get("/auth/profile").json()
    assert "steve_key_cipher" not in body and body["display_name"] == "Ada"


def test_the_notice_in_the_code_is_the_one_in_steve_md():
    doc = " ".join(STEVE_MD.read_text(encoding="utf-8").split())
    assert f"Notice version: `{consent.CONSENT_VERSION}`" in doc
    for paragraph in consent.CONSENT_TEXT.split("\n\n"):
        assert " ".join(paragraph.split()) in doc, paragraph[:60]
    assert consent.TERMS_URL in doc
