"""Which chunk a reader's place is in, so progress follows reading, not quizzes (C32.1, issues 4 and 6).

`chunk_at(book, anchor)` maps a saved place to a chunk index, the same way the bookmark quiz maps its range
(docs/ANCHORS.md A6): a PDF page to the chunk whose anchors' pages hold it, an EPUB CFI to the chunk whose
block paths hold it. Without those (a book whose region map or prose is not built yet) it falls back to the
contents' chapter starts, then to the page's share of the book. None when nothing places it.

A book's map is cached per process (keyed by book and chunk count, so a re-ingested book is read again): a
place is saved about once a second while pages turn, and the chunks' anchors are large.
"""

from bisect import bisect_right
from collections import OrderedDict

from backend.focus.store import unit_of
from backend.services.book_structure import block_for_cfi
from backend.services.supabase_client import supabase

CACHED_BOOKS = 64


def _chunks(book_id: str, columns: str) -> list[dict]:
    rows, start, page = [], 0, 1000
    while True:
        batch = (supabase.table("chunks").select(columns).eq("book_id", book_id).order("chunk_index")
                 .range(start, start + page - 1).execute().data or [])
        rows += batch
        if len(batch) < page:
            return rows
        start += page


_cache: OrderedDict[tuple, tuple] = OrderedDict()


def _cached(key: tuple, load) -> tuple:
    """`load()`, kept for the next call only when it found something (a map built before the book's prose
    exists is read again later); the least recently used book goes first."""
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    value = load()
    if value[0]:
        _cache[key] = value
        while len(_cache) > CACHED_BOOKS:
            _cache.popitem(last=False)
    return value


def _pdf_starts(book_id: str, total: int) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """(first page, chunk index) of every chunk with anchored pages, in page order."""
    def load():
        starts = sorted((c["anchors"]["pages"][0], c["chunk_index"]) for c in _chunks(book_id, "chunk_index, anchors")
                        if (c.get("anchors") or {}).get("pages"))
        return tuple(page for page, _ in starts), tuple(index for _, index in starts)
    return _cached(("pdf", book_id, total), load)


def _epub_paths(book_id: str, total: int) -> tuple[tuple[int, ...], tuple[tuple[dict, ...], ...]]:
    """Every chunk's index and block paths, in chunk order."""
    def load():
        rows = [c for c in _chunks(book_id, "chunk_index, block_paths") if c.get("block_paths")]
        return tuple(c["chunk_index"] for c in rows), tuple(tuple(c["block_paths"]) for c in rows)
    return _cached(("epub", book_id, total), load)


def _from_toc(toc: list[dict], key: str, unit: int) -> int | None:
    entries = sorted((e for e in toc or [] if e.get(key) is not None and e.get("chunk_index") is not None),
                     key=lambda e: e[key])
    before = [e["chunk_index"] for e in entries if e[key] <= unit]
    return max(before) if before else None


def chunk_at(book: dict, anchor: dict) -> int | None:
    """The chunk index the place is in, or None. `book` needs id, total_chunks, page_count and toc."""
    total = int(book.get("total_chunks") or 0)
    if total <= 0:
        return None
    if anchor["kind"] == "pdf":
        page = int(anchor["page"])
        pages, indices = _pdf_starts(book["id"], total)
        if pages:
            at = bisect_right(pages, page) - 1
            return min(total - 1, indices[at] if at >= 0 else indices[0])
        found = _from_toc(book.get("toc"), "page", page)
        if found is not None:
            return min(total - 1, found)
        count = int(book.get("page_count") or 0)
        return min(total - 1, max(0, (page - 1) * total // count)) if count > 0 else None
    indices, paths = _epub_paths(book["id"], total)
    if paths:
        found = block_for_cfi(anchor.get("cfi", ""), [list(p) for p in paths])
        if found is not None:
            return min(total - 1, indices[found[0]])
    spine = unit_of(anchor)
    found = _from_toc(book.get("toc"), "spine_index", spine) if spine is not None else None
    return min(total - 1, found) if found is not None else None
