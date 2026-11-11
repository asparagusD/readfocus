"""Book covers from Open Library (C11.2, handoff decision D5).

One lookup per book, from the backend only: search Open Library by title
and author, take the first result's cover ID, download that cover once and
copy it unchanged into our public `covers` bucket, so readers' browsers
load it from Supabase and never contact Open Library. The outcome is saved
on the book (`cover_url`, `cover_source`) and is never fetched again.

Every failure stores a null `cover_url`: `cover_source` is "none" when Open
Library has no cover and "error" when the lookup failed (a timeout, a
network or storage error), which the backfill may try again. Nothing here
raises. Usage follows Open Library's guidance: one search per book, the
image by cover ID (not rate-limited), a descriptive User-Agent, a 3 s
timeout and a single attempt; the backfill paces itself to one book a
second (scripts/backfill_covers.py).
"""

import logging
import re

import httpx

from backend.services.supabase_client import supabase

log = logging.getLogger(__name__)

SEARCH_URL = "https://openlibrary.org/search.json"
IMAGE_URL = "https://covers.openlibrary.org/b/id/{cover_id}-M.jpg?default=false"
# Names the app and why it calls; no person or email (C11.2 prompt).
USER_AGENT = "ReadFocus/2.0 (reading comprehension app; one cover lookup per uploaded book)"
TIMEOUT_SECONDS = 3.0
MAX_IMAGE_BYTES = 500_000
MAX_REDIRECTS = 3  # covers.openlibrary.org -> archive.org -> an archive.org data node
BUCKET = "covers"

# Titles some tools write into PDF metadata that say nothing about the book.
_JUNK_TITLE = re.compile(
    r"^(untitled|microsoft (word|powerpoint) - .*|.*\.(pdf|docx?|epub|txt|indd))$", re.IGNORECASE)


class LookupFailed(Exception):
    """Open Library could not be asked (timeout, network, bad response)."""


def make_client() -> httpx.Client:
    # httpx makes one attempt per request: no retries unless a transport asks for them.
    return httpx.Client(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}, follow_redirects=False)


_EDITION = re.compile(r"\s*[(\[][^)\]]*[)\]]")  # "(4th Edition)", "[Penguin Classics]"
_AUTHOR_SEPARATOR = re.compile(r"\s*(?:[,;&]|\band\b)\s*")


def _clean_title(title) -> str:
    """Bracketed edition notes and a subtitle after ':' make Open Library's title search miss."""
    return _EDITION.sub("", (title or "").strip()).split(":")[0].strip()


def lookup_terms(meta_title, meta_author, typed_title, typed_author) -> tuple[str, str]:
    """The file's own metadata first; the title and author typed at upload when it has none.

    Only the first author is kept: Open Library matches one name, not a list.
    """
    title = (meta_title or "").strip()
    title = "" if _JUNK_TITLE.match(title) else _clean_title(title)
    title = title or _clean_title(typed_title)
    author = (meta_author or "").strip() or (typed_author or "").strip()
    return title, _AUTHOR_SEPARATOR.split(author, maxsplit=1)[0].strip()


def find_cover_id(client: httpx.Client, title: str, author: str) -> int | None:
    params = {"title": title, **({"author": author} if author else {}),
              "limit": 1, "fields": "cover_i,title,author_name"}
    try:
        response = client.get(SEARCH_URL, params=params)
        response.raise_for_status()
        docs = response.json().get("docs") or []
    except (httpx.HTTPError, ValueError) as e:
        raise LookupFailed(f"search: {e}") from e
    cover_id = docs[0].get("cover_i") if docs else None
    return cover_id if isinstance(cover_id, int) and cover_id > 0 else None


def _image_host(url: httpx.URL) -> bool:
    host = url.host
    return url.scheme == "https" and (host == "covers.openlibrary.org" or host == "archive.org"
                                      or host.endswith(".archive.org"))


def fetch_image(client: httpx.Client, cover_id: int) -> bytes | None:
    """The cover by ID. Open Library redirects it to archive.org storage; only those hosts are followed."""
    url = httpx.URL(IMAGE_URL.format(cover_id=cover_id))
    try:
        for _ in range(MAX_REDIRECTS + 1):
            response = client.get(url)
            if not response.is_redirect:
                break
            url = url.join(response.headers["location"])
            if not _image_host(url):
                return None
        else:
            return None
    except (httpx.HTTPError, KeyError) as e:
        raise LookupFailed(f"image: {e}") from e
    if response.status_code != 200:  # 404: Open Library has no image for this ID
        return None
    if not response.headers.get("content-type", "").startswith("image/jpeg"):
        return None
    if not response.content or len(response.content) > MAX_IMAGE_BYTES:
        return None
    return response.content


def store_image(cover_id: int, data: bytes) -> str:
    """Upload once per cover ID (shared by every book with that cover); returns its public URL."""
    path = f"ol/{cover_id}-M.jpg"
    bucket = supabase.storage.from_(BUCKET)
    bucket.upload(path=path, file=data, file_options={
        "content-type": "image/jpeg", "cache-control": "31536000", "upsert": "true"})
    return bucket.get_public_url(path)


def _save(book_id: str, cover_url: str | None, source: str) -> dict:
    result = {"cover_url": cover_url, "cover_source": source}
    supabase.table("books").update(result).eq("id", book_id).execute()
    return result


def ensure_cover(book_id: str, title: str, author: str, client: httpx.Client | None = None) -> dict:
    """Look up, store and record one book's cover; never raises (except a failure to save the outcome)."""
    title, author = (title or "").strip(), (author or "").strip()
    if not title:
        return _save(book_id, None, "none")
    own = client is None
    client = client or make_client()
    try:
        cover_id = find_cover_id(client, title, author)
        data = fetch_image(client, cover_id) if cover_id else None
        if not data:
            return _save(book_id, None, "none")
        return _save(book_id, store_image(cover_id, data), "openlibrary")
    except Exception as e:  # noqa: BLE001 - a cover is optional; reading never waits on it
        log.warning("cover lookup for book %s failed: %s", book_id, e)
        return _save(book_id, None, "error")
    finally:
        if own:
            client.close()
