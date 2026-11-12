"""Add an original-view anchor to every C12 reading position (docs/ANCHORS.md A7).

reading_progress.position holds C12's flow place {chunk_index, block_id,
char_offset}. The original view (C17.5) opens a PDF at a page and an EPUB at
a CFI, so each place gets an `anchor` key beside its C12 keys (additive: the
old keys stay, nothing is dropped). The place's text (its block from the
offset on, else its chunk's start) is searched for in the book's own file:

- PDF: each page's text (pypdf); the anchor is a point on the first page
  holding it, {"kind": "pdf", "page": n, "quads": [[0, 0, 0, 0]], "text": ""}.
- EPUB: each spine document's body text in spine order; the anchor is a
  collapsed CFI at the first character of the match,
  {"kind": "epub", "cfi": "epubcfi(/6/<2(i+1)>!/4/.../<odd>:<offset>)", "text": ""}
  (the spine document parsed as XML; one that does not parse is skipped).

Text is compared lower-cased with all whitespace removed, so line breaks and
hyphenless joins between pages do not matter. A place whose text is not
found, or whose book has no stored file (device-only, or never kept), is
reported and left as it is. Places that already have an anchor are skipped,
so the script is idempotent.

Run from the repo root with the virtualenv active:

    python scripts/backfill_positions.py --dry-run
    python scripts/backfill_positions.py [--limit N] [--book-id UUID]

--dry-run downloads and searches but writes nothing. It refuses to run unless
ENV=development in .env; any other database needs --allow-non-dev, and a
write needs the user's explicit approval and a fresh dump (CLAUDE.md, hard
constraint 2).
"""

import argparse
import io
import os
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.backfill_structure import check_environment, run  # noqa: E402

SNIPPETS = (40, 20)  # characters (whitespace removed) searched for, longest first
POINT = [[0, 0, 0, 0]]


def squeeze(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def block_text(chunk: dict, block_id: str) -> str:
    """A C12 block's text: chunks.blocks, else the content's paragraphs (as frontend blocks.js split them)."""
    for block in chunk.get("blocks") or []:
        if block.get("id") == block_id:
            return block.get("text") or ""
    paragraphs = [p for p in (re.sub(r"\s+", " ", part).strip() for part in re.split(r"\n\s*\n", chunk.get("content") or "")) if p]
    n = int(block_id.split(".")[1])
    return paragraphs[n] if n < len(paragraphs) else ""


def snippets(position: dict, chunk: dict) -> list[str]:
    """What to search for: the block from the saved offset, then the chunk's start."""
    texts = [block_text(chunk, position["block_id"])[position.get("char_offset") or 0:], chunk.get("content") or ""]
    found = []
    for text in texts:
        flat = squeeze(text)
        found += [flat[:n] for n in SNIPPETS if len(flat) >= n]
    return found


def pdf_page_texts(data: bytes) -> list[str]:
    from pypdf import PdfReader

    return [page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages]


def pdf_anchor(data: bytes, wanted: list[str]) -> dict | None:
    pages = [squeeze(text) for text in pdf_page_texts(data)]
    for snippet in wanted:
        for number, text in enumerate(pages, start=1):
            if snippet in text:
                return {"kind": "pdf", "page": number, "quads": POINT, "text": ""}
    return None


def epub_spine(data: bytes) -> list[bytes]:
    """The spine documents' bytes, in spine order (container.xml, then the package's spine)."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
        opf_path = container.find(".//{*}rootfile").get("full-path")
        package = ElementTree.fromstring(archive.read(opf_path))
        base = posixpath.dirname(opf_path)
        hrefs = {item.get("id"): item.get("href") for item in package.iterfind(".//{*}manifest/{*}item")}
        docs = []
        for ref in package.iterfind(".//{*}spine/{*}itemref"):
            href = hrefs.get(ref.get("idref"))
            try:
                docs.append(archive.read(posixpath.normpath(posixpath.join(base, href))) if href else b"")
            except KeyError:
                docs.append(b"")
        return docs


def text_chunks(element, steps):
    """CFI text chunks under element in document order: (steps, odd index, offset in the chunk, text)."""
    seen, index, offset = 0, 1, 0
    if element.text:
        yield steps, 1, 0, element.text
        offset = len(element.text)
    for child in element:  # ElementTree keeps elements only; their text and tails are the text chunks
        seen += 1
        yield from text_chunks(child, [*steps, 2 * seen])
        index, offset = 2 * seen + 1, 0
        if child.tail:
            yield steps, index, offset, child.tail
            offset += len(child.tail)


def epub_cfi_in(doc: bytes, spine_index: int, wanted: list[str]) -> str | None:
    """A collapsed CFI at the first match of a snippet in this document's body text, or None."""
    if not doc:
        return None
    try:
        root = ElementTree.fromstring(doc)  # XHTML is XML; expat fetches no external entities
    except ElementTree.ParseError:
        return None
    elements = list(root)
    body = next((child for child in elements if child.tag.rsplit("}", 1)[-1] == "body"), None)
    if body is None:
        return None
    flat, where = [], []
    for steps, index, offset, text in text_chunks(body, [2 * (elements.index(body) + 1)]):
        for i, char in enumerate(text):
            if not char.isspace():
                flat.append(char.lower())
                where.append((steps, index, offset + i))
    joined = "".join(flat)
    for snippet in wanted:
        at = joined.find(snippet)
        if at >= 0:
            steps, index, offset = where[at]
            path = "".join(f"/{step}" for step in steps)
            return f"epubcfi(/6/{2 * (spine_index + 1)}!{path}/{index}:{offset})"
    return None


def epub_anchor(data: bytes, wanted: list[str]) -> dict | None:
    docs = epub_spine(data)
    for snippet in wanted:  # the longest snippet across the whole book first
        for i, doc in enumerate(docs):
            cfi = epub_cfi_in(doc, i, [snippet])
            if cfi:
                return {"kind": "epub", "cfi": cfi, "text": ""}
    return None


def pending_rows(supabase, limit=None, book_id=None) -> list[dict]:
    """C12 places with no anchor yet, oldest id first."""
    query = supabase.table("reading_progress").select("id, user_id, book_id, position")
    if book_id:
        query = query.eq("book_id", book_id)
    rows = [row for row in query.execute().data if row.get("position") and "anchor" not in row["position"]
            and row["position"].get("block_id")]
    rows.sort(key=lambda r: r["id"])
    return rows[:limit] if limit is not None else rows


def backfill_row(row, supabase, download, files: dict, dry_run=False) -> str:
    position = row["position"]
    books = supabase.table("books").select("file_format, file_type, storage_path").eq("id", row["book_id"]).execute().data
    if not books or not books[0].get("storage_path"):
        return "skipped: the book has no stored file"
    book = books[0]
    chunks = supabase.table("chunks").select("content, blocks").eq("book_id", row["book_id"]).eq(
        "chunk_index", position["chunk_index"]).execute().data
    if not chunks:
        return "skipped: the chunk is gone"
    if row["book_id"] not in files:
        files[row["book_id"]] = download(book["storage_path"])
    fmt = str(book.get("file_format") or book.get("file_type") or "").lower()
    wanted = snippets(position, chunks[0])
    anchor = pdf_anchor(files[row["book_id"]], wanted) if fmt == "pdf" else epub_anchor(files[row["book_id"]], wanted)
    if not anchor:
        return "skipped: the text was not found in the file"
    where = f"page {anchor['page']}" if anchor["kind"] == "pdf" else anchor["cfi"]
    if dry_run:
        return f"would add {where}"
    supabase.table("reading_progress").update({"position": {**position, "anchor": anchor}}).eq("id", row["id"]).execute()
    return f"added {where}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="download and search; write nothing")
    parser.add_argument("--limit", type=int, help="stop after this many places")
    parser.add_argument("--book-id", help="only this book's places")
    parser.add_argument("--allow-non-dev", action="store_true", help="run although ENV is not development")
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    check_environment(args.allow_non_dev)
    from backend.services.book_ingestor import download
    from backend.services.supabase_client import supabase

    rows = pending_rows(supabase, args.limit, args.book_id)
    print(f"ENV={os.getenv('ENV')}; C12 places without an anchor: {len(rows)}")
    files: dict = {}
    done = run(rows, lambda row: backfill_row(row, supabase, download, files, args.dry_run),
               report=lambda row, outcome: print(f"  {row['id']}  book {row['book_id']}: {outcome}", flush=True))
    print(f"{'checked' if args.dry_run else 'handled'} {done} places")
    return 0


if __name__ == "__main__":
    sys.exit(main())
