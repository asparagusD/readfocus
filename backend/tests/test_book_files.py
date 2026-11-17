"""Original book files (C17.1): sha256 and size stored, a per-reader cap, device-only books, owner-only signed URLs."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from backend.agents import policy
from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.tests.memory_db import MemoryDb

USER, OTHER = "user-1", "user-2"
MB = 1024 * 1024


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = []
    monkeypatch.setattr(books, "supabase", db)
    monkeypatch.setattr(books.jobs, "create", lambda book_id, user_id: {"book_id": book_id})
    monkeypatch.setattr(books.jobs, "claim", lambda job, manual=False: None)  # no ingestion in these tests
    return db


@pytest.fixture
def client(db):
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def upload(client, data=b"%PDF-1.4 tiny", name="b.pdf", **form):
    return client.post("/books/upload", files={"file": (name, data, "application/pdf")},
                       data={"title": "t", "author": "a", **form})


def add_book(db, book_id, user_id=USER, size=MB, mode="cloud"):
    db.tables["books"].append({"id": book_id, "user_id": user_id, "file_type": "pdf", "file_bytes": size,
                               "storage_mode": mode, "storage_path": f"{user_id}/{book_id}.pdf" if mode == "cloud" else None})


def test_upload_stores_sha256_size_format_and_cloud_mode(client, db):
    data = b"%PDF-1.4 some book bytes"
    resp = upload(client, data)
    assert resp.status_code == 200
    row = db.tables["books"][0]
    assert row["file_sha256"] == hashlib.sha256(data).hexdigest()
    assert row["file_bytes"] == len(data) and row["file_format"] == "pdf" and row["storage_mode"] == "cloud"
    assert db.files[row["storage_path"]] == data


def test_the_per_reader_cap_refuses_an_upload_that_would_pass_it(client, db, monkeypatch):
    monkeypatch.setattr(policy, "MAX_SHELF_BYTES_PER_USER", 3 * MB)
    add_book(db, "old", size=3 * MB - 10)
    add_book(db, "theirs", user_id=OTHER, size=50 * MB)  # another reader's books never count
    resp = upload(client, b"x" * 20)
    assert resp.status_code == 413
    assert "300 MB" not in resp.json()["detail"] and "3 MB" in resp.json()["detail"]
    assert len(db.tables["books"]) == 2 and ("storage", "upload") not in db.calls


def test_device_books_do_not_count_toward_the_cap(client, db, monkeypatch):
    monkeypatch.setattr(policy, "MAX_SHELF_BYTES_PER_USER", 3 * MB)
    add_book(db, "local", size=3 * MB, mode="device")
    assert upload(client, b"x" * 20).status_code == 200


def test_a_device_only_upload_is_never_stored(client, db):
    resp = upload(client, b"%PDF-1.4 private", storage_mode="device")
    assert resp.status_code == 200
    row = db.tables["books"][-1]
    assert row["storage_mode"] == "device" and row["storage_path"] is None
    assert row["file_sha256"] == hashlib.sha256(b"%PDF-1.4 private").hexdigest()
    assert ("storage", "upload") not in db.calls and db.files == {}


def test_an_unknown_storage_mode_is_refused(client, db):
    assert upload(client, storage_mode="somewhere").status_code == 422


def test_a_file_over_the_per_file_limit_is_refused_before_storage(client, db, monkeypatch):
    monkeypatch.setattr(policy, "MAX_BOOK_FILE_BYTES", 100)
    resp = upload(client, b"x" * 101)
    assert resp.status_code == 413 and db.tables["books"] == [] and db.files == {}


def test_the_owner_gets_a_short_lived_signed_url(client, db):
    add_book(db, "b1")
    resp = client.get("/books/b1/file")
    assert resp.status_code == 200
    body = resp.json()
    assert body["url"].startswith("https://storage.test/sign/books/user-1/b1.pdf")
    assert body["expires_in"] == policy.BOOK_FILE_URL_SECONDS <= 600
    assert body["sha256"] is None or isinstance(body["sha256"], str)


def test_no_signed_url_for_another_readers_book(client, db):
    add_book(db, "theirs", user_id=OTHER)
    assert client.get("/books/theirs/file").status_code == 404
    assert not [call for call in db.calls if call[:2] == ("storage", "sign")]


def test_a_device_only_book_has_no_file_on_the_server(client, db):
    add_book(db, "local", mode="device")
    resp = client.get("/books/local/file")
    assert resp.status_code == 404 and "only on the device" in resp.json()["detail"]


def test_a_device_only_book_cannot_be_resumed_without_its_file(client, db):
    add_book(db, "local", mode="device")
    resp = client.post("/books/local/resume")
    assert resp.status_code == 409 and "add the file again" in resp.json()["detail"]
