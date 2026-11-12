"""C17.6: each EPUB block's spine index and element path (chunks.block_paths), CFI -> block, and books.toc
from the PDF outline or the EPUB nav. On the reader fixture books; no network."""

from pathlib import Path

from backend.services import book_ingestor, book_structure

BOOKS = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "books"
EPUB = (BOOKS / "reflow.epub").read_bytes()
PDF = (BOOKS / "sample.pdf").read_bytes()
MIGRATION = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "017_block_paths.sql"


def built(file_type, data):
    chunks = book_ingestor.chunk_text(book_ingestor.extract(file_type, data), book_ingestor.TARGET_WORDS)
    return chunks, book_structure.build_with_paths(file_type, data, chunks)


def by_text(blocks, paths, start):
    for chunk_blocks, chunk_paths in zip(blocks, paths):
        for block, path in zip(chunk_blocks, chunk_paths):
            if block["text"].startswith(start) and path["spine_index"] is not None:  # not the nav document
                return block, path
    raise AssertionError(start)


def test_every_epub_block_has_its_spine_index_and_element_path():
    _chunks, (blocks, _toc, paths) = built("epub", EPUB)
    assert [len(p) for p in paths] == [len(b) for b in blocks]  # one entry per block, in the same order
    for chunk_blocks, chunk_paths in zip(blocks, paths):
        assert [p["block_id"] for p in chunk_paths] == [b["id"] for b in chunk_blocks]
    heading, path = by_text(blocks, paths, "Chapter 1")
    assert path == {"block_id": heading["id"], "spine_index": 1, "path": "/4/2"}  # <body>, then its first child <h1>
    assert by_text(blocks, paths, "Figure 1.1")[1]["path"] == "/4/6/4"  # <figure> third, <figcaption> after the <img>
    assert by_text(blocks, paths, "Chapter 3")[1]["spine_index"] == 3
    assert "path" not in heading and "spine_index" not in heading  # chunks.blocks keeps its C12 shape


def test_a_cfi_maps_to_the_block_holding_it():
    _chunks, (blocks, _toc, paths) = built("epub", EPUB)
    heading, _ = by_text(blocks, paths, "Chapter 1")
    caption, _ = by_text(blocks, paths, "Figure 1.1")
    chunk_of = {b["id"]: i for i, chunk in enumerate(blocks) for b in chunk}
    assert book_structure.block_for_cfi("epubcfi(/6/4!/4/2/1:0)", paths) == (chunk_of[heading["id"]], heading["id"])
    assert book_structure.block_for_cfi("epubcfi(/6/4!/4/6/4,/1:0,/1:6)", paths) == (chunk_of[caption["id"]], caption["id"])
    assert book_structure.block_for_cfi("epubcfi(/6/2!/4/2)", paths) is None  # the cover has no text
    assert book_structure.block_for_cfi("nonsense", paths) is None


def test_epub_contents_come_from_the_nav_with_their_sections_and_blocks():
    _chunks, (blocks, toc, _paths) = built("epub", EPUB)
    assert [(e["title"], e["spine_index"]) for e in toc] == [("Cover", 0), ("Chapter 1", 1), ("Chapter 2", 2), ("Chapter 3", 3)]
    chapter2 = toc[2]
    block = blocks[chapter2["chunk_index"]][int(chapter2["block_id"].split(".")[1])]
    assert block["text"].startswith("Chapter 2") and chapter2["href"].endswith("ch2.xhtml")


def test_pdf_contents_come_from_the_outline_with_their_pages_and_chunks():
    chunks, (_blocks, toc, paths) = built("pdf", PDF)
    assert paths is None  # a PDF's places are pages and quads, not element paths
    assert [(e["title"], e["page"]) for e in toc] == [("Chapter 1 Signals", 3), ("Chapter 2 Noise", 5)]
    for entry in toc:
        assert 0 <= entry["chunk_index"] < len(chunks)
        assert entry["block_id"].startswith(f"{entry['chunk_index']}.")


def test_a_book_with_no_outline_keeps_the_chapter_contents():
    chunks = ["Chapter 1\n\nIt began.", "Chapter 2\n\nIt went on."]
    blocks, toc, paths = book_structure.build_with_paths("pdf", b"not a pdf", chunks)
    assert [e["title"] for e in toc] == ["Chapter 1", "Chapter 2"] and paths is None
    assert book_structure.build("pdf", b"not a pdf", chunks) == (blocks, toc)


def test_migration_017_adds_block_paths_only():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS block_paths jsonb;" in sql
    assert "DROP" not in sql.upper()


def test_ingestion_stores_block_paths_beside_the_blocks():
    source = Path(book_ingestor.__file__).read_text(encoding="utf-8")
    assert '"block_paths": paths[start + offset] if paths else None' in source
