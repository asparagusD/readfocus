"""C30.1 (issue 2): the author is optional at upload; a blank one comes from the file's own metadata."""

import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from backend.dependencies import get_current_user
from backend.main import app
from backend.routers import books
from backend.tests.memory_db import MemoryDb

USER = "user-1"


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


def pdf(author=None) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    if author is not None:
        writer.add_metadata({"/Author": author, "/Title": "From the file"})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def epub(creator=None) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                         '<rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        name = f"<dc:creator>{creator}</dc:creator>" if creator else ""
        archive.writestr("OEBPS/content.opf", '<package xmlns="http://www.idpf.org/2007/opf" '
                         'xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>T</dc:title>'
                         f"{name}</metadata></package>")
    return out.getvalue()


def upload(client, data, name="b.pdf", **form):
    return client.post("/books/upload", files={"file": (name, data, "application/octet-stream")},
                       data={"title": "A book", **form})


def test_a_typed_author_is_kept_over_the_files(client, db):
    resp = upload(client, pdf("Someone Else"), author="  Ada   Lovelace ")
    assert resp.status_code == 200
    assert db.tables["books"][0]["author"] == "Ada Lovelace" and resp.json()["author"] == "Ada Lovelace"


def test_a_pdf_with_no_author_typed_takes_the_one_in_its_info(client, db):
    resp = upload(client, pdf("Harold Abelson"))  # no author field sent at all
    assert resp.status_code == 200
    assert db.tables["books"][0]["author"] == "Harold Abelson" and resp.json()["author"] == "Harold Abelson"


def test_an_epub_with_a_blank_author_takes_its_dc_creator(client, db):
    resp = upload(client, epub("Lewis Carroll"), name="b.epub", author="   ")
    assert resp.status_code == 200
    assert db.tables["books"][0]["author"] == "Lewis Carroll"


@pytest.mark.parametrize("data,name", [(pdf(), "b.pdf"), (epub(), "b.epub"), (b"%PDF-1.4 not really", "b.pdf")])
def test_a_file_that_names_no_author_is_stored_without_one(client, db, data, name):
    resp = upload(client, data, name=name, author="")
    assert resp.status_code == 200
    assert db.tables["books"][0]["author"] is None and resp.json()["author"] is None


def test_an_authors_name_from_the_file_is_tidied_and_capped(client, db):
    upload(client, pdf("  Gerald \n  Jay   Sussman  " + "x" * 400))
    author = db.tables["books"][0]["author"]
    assert author.startswith("Gerald Jay Sussman") and len(author) == books.AUTHOR_MAX
