"""Uploading Markdown, a Markdown .zip or a notebook (C19.2c): converted on the server, stored as the book's EPUB."""

import hashlib
import io
import zipfile
from pathlib import Path

import pytest

from backend.agents import policy
from backend.convert.epub_builder import check_epub
from backend.convert.sources import convert_upload
from backend.tests import test_book_files
from backend.tests.test_epub_builder import SVG, png

SOURCES = Path(__file__).parent / "fixtures" / "sources"
MD = (SOURCES / "sample.md").read_bytes()
client, db = test_book_files.client, test_book_files.db  # the upload fixtures (memory db, signed-in reader)
NOTEBOOK = (SOURCES / "sample.ipynb").read_bytes()


def zipped(files: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return out.getvalue()


def send(client, name, data, **form):
    return client.post("/books/upload", files={"file": (name, data, "application/octet-stream")},
                       data={"title": "My notes", "author": "Ada", **form})


def epub_images(data: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return [n for n in archive.namelist() if n.startswith("OEBPS/images/")]


@pytest.mark.parametrize("name, data, fmt, images", [
    ("notes.md", MD, "md", 0),
    ("lab.ipynb", NOTEBOOK, "ipynb", 3),
    ("notes.zip", zipped({"notes/sample.md": MD, "notes/figures/spectrum.png": png(8, 4),
                          "notes/figures/filter.svg": SVG}), "md", 2),
])
def test_a_source_is_stored_as_the_books_epub(client, db, name, data, fmt, images):
    resp = send(client, name, data)
    assert resp.status_code == 200, resp.text
    row = db.tables["books"][0]
    stored = db.files[row["storage_path"]]
    assert row["storage_path"].endswith(".epub")
    assert (row["file_type"], row["file_format"], row["source_format"]) == ("epub", "epub", fmt)
    assert row["file_sha256"] == hashlib.sha256(stored).hexdigest() and row["file_bytes"] == len(stored)
    assert check_epub(stored) == []
    assert len(epub_images(stored)) == images
    assert resp.json()["source_format"] == fmt


def test_remote_and_missing_images_are_listed_in_the_response(client, db):
    notes = send(client, "notes.md", MD).json()["notes"]
    assert any("https://example.org/chart.png" in n for n in notes)
    assert sum("figures/" in n for n in notes) == 2  # a single .md has no image files


def test_the_title_and_author_typed_at_upload_name_the_epub(client, db):
    send(client, "notes.md", MD)
    stored = db.files[db.tables["books"][0]["storage_path"]]
    with zipfile.ZipFile(io.BytesIO(stored)) as archive:
        opf = archive.read("OEBPS/content.opf").decode()
    assert "<dc:title>My notes</dc:title>" in opf and "<dc:creator>Ada</dc:creator>" in opf


def test_a_converted_source_cannot_stay_on_the_device(client, db):
    resp = send(client, "notes.md", MD, storage_mode="device")
    assert resp.status_code == 400 and "device" in resp.json()["detail"]
    assert db.tables["books"] == [] and db.files == {}


@pytest.mark.parametrize("name, data, message", [
    ("lab.ipynb", b"{not json", "not a Jupyter notebook"),
    ("notes.zip", zipped({"a.png": png(2, 2)}), "no Markdown"),
    ("notes.zip", zipped({"a/x.md": b"# A", "b/y.md": b"# B"}), "more than one"),
    ("notes.zip", b"PK broken", "not a readable .zip"),
    ("notes.md", b"\xff\xfe\x00bad", "UTF-8"),
])
def test_a_source_that_cannot_convert_is_refused_with_a_reason(client, db, name, data, message):
    resp = send(client, name, data)
    assert resp.status_code == 400 and message in resp.json()["detail"]
    assert db.tables["books"] == [] and db.files == {}


def test_other_files_are_still_refused(client, db):
    assert send(client, "notes.docx", b"PK").status_code == 400


def test_the_upload_works_before_migration_021_is_applied(client, db, monkeypatch):
    real = db.table

    def table(name):
        query = real(name)
        update = query.update

        def failing(values):
            if "source_format" in values:
                raise RuntimeError("column books.source_format does not exist")
            return update(values)
        query.update = failing
        return query
    monkeypatch.setattr(db, "table", table)
    resp = send(client, "notes.md", MD)
    assert resp.status_code == 200 and "source_format" not in db.tables["books"][0]


def test_zip_rules_readme_preferred_and_no_escape():
    data = zipped({"docs/README.md": b"# Read me\n\n![x](../../secret.png)\n", "docs/other/notes.md": b"# Other",
                   "secret.png": png(2, 2)})
    fmt, converted = convert_upload("bundle.zip", data)
    assert fmt == "md" and converted.title == "Read me" and converted.images == []


def test_a_zip_too_large_unpacked_is_refused(monkeypatch):
    monkeypatch.setattr(policy, "MAX_CONVERT_UNPACKED_BYTES", 1000)
    with pytest.raises(ValueError, match="too large"):
        convert_upload("big.zip", zipped({"a.md": b"# A\n" + b"x" * 2000}))
