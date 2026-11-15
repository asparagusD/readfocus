"""Where a book's body (chapter 1) begins, for focus mode (C23.1, docs/FOCUS_RULES.md F2).

Detection, in order, each step only when the one before finds nothing:
  1. outline: the PDF outline or EPUB nav (books.toc): an entry for chapter 1 ("Chapter 1", "Chapter One",
     "1 Introduction", "1. Loomings"), or "Part I" / "Part One" when a chapter follows it; else the first entry
     that is not front matter (policy.BODY_START_FRONT_MATTER, a bare "Introduction" among them);
  2. heading: the first region in the region map (page_regions) whose first line is such a heading, skipping
     contents pages;
  3. prose: the first page or EPUB section after the contents with at least BODY_START_MIN_PROSE_WORDS words of
     prose.
The result is {kind, page | spine_index, title, anchor}, the anchor an A3 point (docs/ANCHORS.md). Pure apart from
`for_book`, which reads a book's regions.
"""

import re

from backend.agents import policy

_ONE = r"(?:1|one|i)"
_CHAPTER = r"(?:chapter\s*|ch\.\s*|ch\s+)"  # "Chapter 1", "Chapter1", "Ch. 1", "Ch 1"; not "Chi"
_CHAPTER_ONE = re.compile(rf"^{_CHAPTER}{_ONE}\b(?!\.?\d)|^1[.:)]?\s+(?!\d)", re.IGNORECASE)
_BARE_ONE = re.compile(r"^1[.:)]?$")  # "1" alone: chapter 1 in an outline, a folio on a page
_WORDED = re.compile(rf"^(?:{_CHAPTER}|part\s)", re.IGNORECASE)
# A numbered contents line: a number, a title, then its page ("1 Springs ..... 7"); not "26 mV".
_LISTED = re.compile(r"^\d+[.:)]?\s+[a-z].*?[\s.]\d+$", re.IGNORECASE)
_PART_ONE = re.compile(rf"^part\s+{_ONE}\b", re.IGNORECASE)
# Any chapter heading or contents line; a bare number (a folio, "1") is not one.
_ANY_CHAPTER = re.compile(rf"^{_CHAPTER}[a-z\d]+\b|^\d+[.:)]?\s+\S", re.IGNORECASE)
_FRONT = re.compile(r"^(?:{})(?![a-z])".format("|".join(re.escape(t) for t in policy.BODY_START_FRONT_MATTER)), re.IGNORECASE)
_CONTENTS = re.compile(r"^(?:table of )?contents\b", re.IGNORECASE)
_PROSE_KINDS = ("prose", "block")


def _clean(title) -> str:
    return re.sub(r"\s+", " ", str(title or "")).strip()


def chapter_one(titles: list[str], bare: bool = True):
    """Index of the chapter-1 entry (or of "Part I" when a chapter comes after it), or None. `bare`: a title that
    is only "1" counts (an outline; not a page's lines, where it is a page number)."""
    for n, title in enumerate(titles):
        text = _clean(title)
        if _CHAPTER_ONE.search(text) or (bare and _BARE_ONE.match(text)):
            return n
        if _PART_ONE.search(text) and any(_ANY_CHAPTER.search(_clean(t)) for t in titles[n + 1:n + 2]):
            return n
    return None


def _unit(entry: dict, chunk_units: dict | None):
    """An outline entry's PDF page or EPUB spine index: its own, else its chunk's (an outline built from the
    text's chapter headings carries only chunk_index)."""
    if entry.get("page"):
        return entry["page"]
    if entry.get("spine_index") is not None:
        return entry["spine_index"]
    return (chunk_units or {}).get(entry.get("chunk_index"))


def pick_outline(toc: list[dict], chunk_units: dict | None = None):
    """(the outline entry the body starts at, its page or spine index), or None."""
    entries = [(e, u) for e in toc or [] if isinstance(e, dict) and (u := _unit(e, chunk_units)) is not None]
    titles = [_clean(e.get("title")) for e, _u in entries]
    n = chapter_one(titles)
    if n is None:
        n = next((i for i, t in enumerate(titles) if t and not _FRONT.search(t)), None)
    return entries[n] if n is not None else None


def place(kind: str, unit: int, title: str | None) -> dict:
    """The stored body start for PDF page `unit` (1-based) or EPUB spine index `unit`."""
    title = _clean(title)[:policy.BODY_START_TITLE_MAX] or None
    if kind == "pdf":
        return {"kind": "pdf", "page": unit, "title": title,
                "anchor": {"kind": "pdf", "page": unit, "quads": [[0, 0, 0, 0]], "text": ""}}
    # The section's body: spine itemref steps are even (/6/2 is the first), the body element is /4 after <head>.
    return {"kind": "epub", "spine_index": unit, "title": title,
            "anchor": {"kind": "epub", "cfi": f"epubcfi(/6/{2 * (unit + 1)}!/4)", "text": ""}}


def _units(kind: str, regions: list[dict]) -> list[tuple[int, list[dict]]]:
    """Regions grouped by page or spine index, in reading order."""
    key = "page" if kind == "pdf" else "spine_index"
    units: dict[int, list[dict]] = {}
    for r in regions:
        if r.get(key) is not None:
            units.setdefault(r[key], []).append(r)
    return [(u, sorted(rs, key=lambda r: r.get("order_in_page") or 0)) for u, rs in sorted(units.items())]


def _first_line(region: dict) -> str:
    return _clean((region.get("text") or "").strip().split("\n", 1)[0])


def _contents_like(regions: list[dict]) -> bool:
    lines = [_clean(line) for r in regions for line in (r.get("text") or "").split("\n")]
    short = [line for line in lines if len(line) <= policy.BODY_START_HEADING_MAX_CHARS]  # not a numbered paragraph
    return any(_CONTENTS.match(line) for line in short) or \
        sum(bool(_WORDED.match(line) or _LISTED.match(line)) for line in short) >= policy.BODY_START_CONTENTS_LINES


def _heading(line: str, order: int) -> bool:
    """A region's first line that can be a chapter heading: "Chapter 1" or "Part One" anywhere on the page; a
    numbered one ("1 Springs") only among the page's first regions and without a closing full stop, so a
    numbered list ("1. Guaranteed by design.") is not taken for one."""
    if not 0 < len(line) <= policy.BODY_START_HEADING_MAX_CHARS:
        return False
    return bool(_WORDED.match(line)) or (order < policy.BODY_START_HEADING_TOP and not line.endswith("."))


def _words(regions: list[dict]) -> int:
    return sum(len((r.get("text") or "").split()) for r in regions if r.get("kind") in _PROSE_KINDS)


def detect(kind: str, toc: list[dict] | None, regions: list[dict], chunk_units: dict | None = None):
    """{source, body_start} for a book ("pdf" or "epub"), or None when nothing points at a body start.
    `chunk_units` maps a chunk index to its first page or spine index, for outline entries that have neither."""
    kind = "pdf" if kind == "pdf" else "epub"
    picked = pick_outline(toc or [], chunk_units)
    if picked is not None:
        entry, unit = picked
        return {"source": "outline", "body_start": place(kind, unit, entry.get("title"))}

    units = _units(kind, regions)[:policy.BODY_START_SCAN_UNITS]
    contents = [_contents_like(rs) for _u, rs in units]
    headings = [(u, _first_line(r)) for (u, rs), skip in zip(units, contents) if not skip
                for n, r in enumerate(rs) if r.get("kind") in _PROSE_KINDS and _heading(_first_line(r), n)]
    n = chapter_one([title for _u, title in headings], bare=False)
    if n is not None:
        return {"source": "heading", "body_start": place(kind, headings[n][0], headings[n][1])}

    after = next((i for i, skip in enumerate(contents) if skip), -1)  # the contents: its first run of pages
    while 0 <= after < len(contents) - 1 and contents[after + 1]:
        after += 1
    for (u, rs), skip in list(zip(units, contents))[after + 1:]:
        if not skip and _words(rs) >= policy.BODY_START_MIN_PROSE_WORDS:
            return {"source": "prose", "body_start": place(kind, u, None)}
    return None


def _chunk_units(db, book_id: str, kind: str, toc: list[dict]) -> dict:
    """{chunk_index: first page or spine index} from chunks.anchors (A6), for outline entries with neither."""
    wanted = sorted({e["chunk_index"] for e in toc if isinstance(e, dict) and e.get("chunk_index") is not None
                     and not e.get("page") and e.get("spine_index") is None})
    if not wanted:
        return {}
    rows = db.table("chunks").select("chunk_index, anchors").eq("book_id", book_id).in_("chunk_index", wanted).execute().data
    units = {}
    for row in rows or []:
        anchors = row.get("anchors") or {}
        unit = (anchors.get("pages") or [None])[0] if kind == "pdf" else (anchors.get("start") or {}).get("spine_index")
        if unit is not None:
            units[row["chunk_index"]] = unit
    return units


def for_book(db, book: dict):
    """detect() for one books row (id, file_type, toc), reading chunk anchors for an outline without pages, and
    its first pages' regions only when the outline gives nothing."""
    kind = "pdf" if str(book.get("file_type") or "").lower() == "pdf" else "epub"
    toc = book.get("toc") or []
    found = detect(kind, toc, [], _chunk_units(db, book["id"], kind, toc))
    if found:
        return found
    key = "page" if kind == "pdf" else "spine_index"
    limit = policy.BODY_START_SCAN_UNITS if kind == "pdf" else policy.BODY_START_SCAN_UNITS - 1
    regions, start, size = [], 0, 1000
    while True:  # Supabase returns at most 1000 rows a call
        rows = db.table("page_regions").select(f"{key}, kind, text, order_in_page").eq("book_id", book["id"]).lte(
            key, limit).order(key).order("order_in_page").range(start, start + size - 1).execute().data or []
        regions.extend(rows)
        if len(rows) < size:
            break
        start += size
    return detect(kind, None, regions)
