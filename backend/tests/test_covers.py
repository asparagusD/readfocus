"""Book covers from Open Library (C11.2), with every HTTP call mocked."""

import io
import zipfile

import httpx
import pytest
from pypdf import PdfWriter

from backend.services import book_ingestor, covers
from backend.tests.memory_db import MemoryDb

BOOK = "book-1"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 2000


@pytest.fixture
def db(monkeypatch):
    db = MemoryDb()
    db.tables["books"] = [{"id": BOOK, "title": "Walden", "author": "Thoreau", "cover_url": None, "cover_source": None}]
    monkeypatch.setattr(covers, "supabase", db)
    return db


def client_for(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), headers={"User-Agent": covers.USER_AGENT},
                        timeout=covers.TIMEOUT_SECONDS)


def open_library(search=None, image=None, seen=None):
    """A mock Open Library: `search` is the JSON body or an exception, `image` a response or exception."""
    def handler(request):
        if seen is not None:
            seen.append(request)
        if request.url.host == "openlibrary.org":
            if isinstance(search, Exception):
                raise search
            return httpx.Response(200, json=search)
        if isinstance(image, Exception):
            raise image
        return image
    return handler


def book_row(db):
    return db.tables["books"][0]


def test_hit_stores_the_cover_in_our_bucket_and_records_its_url(db):
    seen = []
    handler = open_library({"docs": [{"cover_i": 123, "title": "Walden"}]},
                           httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"}), seen)
    result = covers.ensure_cover(BOOK, "Walden", "Henry David Thoreau", client=client_for(handler))

    assert result == {"cover_url": "https://storage.test/covers/ol/123-M.jpg", "cover_source": "openlibrary"}
    assert db.files["ol/123-M.jpg"] == JPEG
    assert book_row(db)["cover_url"] == "https://storage.test/covers/ol/123-M.jpg"
    assert book_row(db)["cover_source"] == "openlibrary"
    search, image = seen
    assert search.url.path == "/search.json"
    assert dict(search.url.params) == {"title": "Walden", "author": "Henry David Thoreau", "limit": "1",
                                       "fields": "cover_i,title,author_name"}
    assert str(image.url) == "https://covers.openlibrary.org/b/id/123-M.jpg?default=false"
    assert all(r.headers["user-agent"] == covers.USER_AGENT for r in seen)


def test_the_image_follows_open_library_redirects_to_archive_org(db):
    # Found on dev (C11.2): covers.openlibrary.org answers 302 to archive.org.
    def handler(request):
        host = request.url.host
        if host == "openlibrary.org":
            return httpx.Response(200, json={"docs": [{"cover_i": 77}]})
        if host == "covers.openlibrary.org":
            return httpx.Response(302, headers={"location": "https://archive.org/download/m_covers/77-M.jpg"})
        if host == "archive.org":
            return httpx.Response(302, headers={"location": "https://ia800505.us.archive.org/view/77-M.jpg"})
        return httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"})
    assert covers.ensure_cover(BOOK, "Walden", "", client=client_for(handler))["cover_source"] == "openlibrary"
    assert db.files["ol/77-M.jpg"] == JPEG


def test_an_image_redirect_off_archive_org_is_refused(db):
    def handler(request):
        if request.url.host == "openlibrary.org":
            return httpx.Response(200, json={"docs": [{"cover_i": 78}]})
        if request.url.host == "covers.openlibrary.org":
            return httpx.Response(302, headers={"location": "https://example.com/78.jpg"})
        return httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"})
    assert covers.ensure_cover(BOOK, "Walden", "", client=client_for(handler))["cover_url"] is None
    assert db.files == {}


def test_user_agent_names_the_app_and_no_person():
    assert covers.USER_AGENT.startswith("ReadFocus/")
    assert "@" not in covers.USER_AGENT


@pytest.mark.parametrize("search", [{"docs": []}, {"docs": [{"title": "Walden"}]}, {"numFound": 0}])
def test_miss_stores_null_and_fetches_no_image(db, search):
    seen = []
    result = covers.ensure_cover(BOOK, "Walden", "Thoreau", client=client_for(open_library(search, seen=seen)))
    assert result == {"cover_url": None, "cover_source": "none"}
    assert len(seen) == 1 and db.files == {}
    assert book_row(db)["cover_url"] is None and book_row(db)["cover_source"] == "none"


def test_missing_image_is_a_miss(db):
    handler = open_library({"docs": [{"cover_i": 9}]}, httpx.Response(404))
    assert covers.ensure_cover(BOOK, "Walden", "", client=client_for(handler))["cover_source"] == "none"
    assert db.files == {}


@pytest.mark.parametrize("image", [
    httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"}),
    httpx.Response(200, content=b"\xff" * (covers.MAX_IMAGE_BYTES + 1), headers={"content-type": "image/jpeg"}),
])
def test_an_image_that_is_not_a_cover_is_a_miss(db, image):
    handler = open_library({"docs": [{"cover_i": 9}]}, image)
    assert covers.ensure_cover(BOOK, "Walden", "", client=client_for(handler))["cover_url"] is None
    assert db.files == {}


@pytest.mark.parametrize("search, image", [
    (httpx.ReadTimeout("slow"), None),
    (httpx.ConnectError("down"), None),
    ({"docs": [{"cover_i": 5}]}, httpx.ReadTimeout("slow")),
])
def test_timeout_or_network_failure_stores_null_without_raising(db, search, image):
    result = covers.ensure_cover(BOOK, "Walden", "Thoreau", client=client_for(open_library(search, image)))
    assert result == {"cover_url": None, "cover_source": "error"}
    assert book_row(db)["cover_url"] is None and book_row(db)["cover_source"] == "error"


def test_server_error_and_bad_json_store_null(db):
    def handler(request):
        return httpx.Response(503) if request.url.host == "openlibrary.org" else httpx.Response(200)
    assert covers.ensure_cover(BOOK, "Walden", "", client=client_for(handler))["cover_source"] == "error"

    def junk(request):
        return httpx.Response(200, content=b"not json")
    assert covers.ensure_cover(BOOK, "Walden", "", client=client_for(junk))["cover_source"] == "error"


def test_a_storage_failure_stores_null(db, monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("bucket missing")
    monkeypatch.setattr(covers, "store_image", lambda cover_id, data: broken())
    handler = open_library({"docs": [{"cover_i": 1}]}, httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"}))
    assert covers.ensure_cover(BOOK, "Walden", "", client=client_for(handler)) == {"cover_url": None, "cover_source": "error"}


def test_no_title_means_no_request(db):
    seen = []
    assert covers.ensure_cover(BOOK, "  ", "Thoreau", client=client_for(open_library(seen=seen)))["cover_source"] == "none"
    assert seen == []


def test_the_default_client_has_a_3_second_timeout_and_one_attempt():
    client = covers.make_client()
    assert client.timeout.read == client.timeout.connect == 3.0
    assert client.headers["user-agent"] == covers.USER_AGENT
    assert client.follow_redirects is False


# Lookup terms: the file's own metadata first, the title typed at upload as the fallback.

@pytest.mark.parametrize("meta, typed, expected", [
    (("Walden; or, Life in the Woods", "Henry David Thoreau"), ("walden", "HDT"),
     ("Walden; or, Life in the Woods", "Henry David Thoreau")),
    ((None, None), ("Walden", "Thoreau"), ("Walden", "Thoreau")),
    (("Microsoft Word - walden.docx", "jsmith"), ("Walden", "Thoreau"), ("Walden", "jsmith")),
    (("untitled", ""), ("Walden", None), ("Walden", "")),
    (("walden.pdf", "Thoreau"), ("Walden", ""), ("Walden", "Thoreau")),
])
def test_lookup_terms(meta, typed, expected):
    assert covers.lookup_terms(*meta, *typed) == expected


# Found on dev (C11.2): the full metadata title and both authors matched
# nothing; the cleaned query finds the book.
@pytest.mark.parametrize("meta, expected", [
    (("Digital Design and Computer Architecture (4th Edition)", "David Harris, Sarah Harris"),
     ("Digital Design and Computer Architecture", "David Harris")),
    (("Meditations [Penguin Classics]", "Marcus Aurelius; Martin Hammond"), ("Meditations", "Marcus Aurelius")),
    (("Walden: or, Life in the Woods", "Henry David Thoreau and Bill McKibben"), ("Walden", "Henry David Thoreau")),
    (("(Abridged)", "A & B"), ("Typed", "A")),
])
def test_lookup_terms_drop_editions_subtitles_and_extra_authors(meta, expected):
    assert covers.lookup_terms(*meta, "Typed", None) == expected


def make_pdf(**metadata):
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    if metadata:
        writer.add_metadata(metadata)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def make_epub(title, creator):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
                   '</rootfiles></container>')
        z.writestr("OEBPS/content.opf",
                   '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
                   '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
                   f'<dc:title>{title}</dc:title><dc:creator>{creator}</dc:creator></metadata></package>')
    return out.getvalue()


def test_metadata_from_pdf_info():
    data = make_pdf(**{"/Title": "Walden", "/Author": "Henry David Thoreau"})
    assert book_ingestor.extract_metadata("pdf", data) == ("Walden", "Henry David Thoreau")
    assert book_ingestor.extract_metadata("pdf", make_pdf()) == (None, None)


def test_metadata_from_epub_opf():
    assert book_ingestor.extract_metadata("epub", make_epub("Meditations", "Marcus Aurelius")) == (
        "Meditations", "Marcus Aurelius")


@pytest.mark.parametrize("file_type, data", [("pdf", b"%PDF-broken"), ("epub", b"not a zip"), ("txt", b"")])
def test_unreadable_metadata_is_none(file_type, data):
    assert book_ingestor.extract_metadata(file_type, data) == (None, None)
