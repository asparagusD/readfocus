"""OCR text for scanned PDF pages (C19.4): checked, stored, and handed to ingestion.

The reader's browser runs tesseract.js (English) on a scanned page and posts
its words, each with a box in PDF points from the page's top-left (ANCHORS
A1), a confidence, and its paragraph and line numbers. Nothing is trusted:
`clean_page` drops words that are too long, unsure (`OCR_MIN_CONFIDENCE`),
off the page, or inside a math, code, table or figure region (never OCR
math or drawings; the scan itself, a figure over most of the page, does not
count), then drops every line `is_garbled` flags. What is left becomes the
page's text (paragraphs split by blank lines), its prose regions, and the
words for the reader's text layer.

When every scanned page of a book with no chunks yet (a fully scanned book)
has its text, the book is ingested again from pypdf text plus OCR text, so
it gets chunks, questions and search. A book with chunks keeps them: its
OCR feeds the text layer, regions and word lookup only (C18: stored chunk
text never changes once questions quote it). Pure functions first; I/O last.
"""

from collections import defaultdict

from backend.agents import policy
from backend.regions.garble import is_garbled
from backend.services.supabase_client import supabase

TABLE = "page_ocr"
SKIPPED_KINDS = {"math", "code", "table", "figure"}
TEXT_KINDS = ("block", "prose", "unreadable")


def _inside(word_box: list[float], box: list[float]) -> bool:
    x, y = (word_box[0] + word_box[2]) / 2, (word_box[1] + word_box[3]) / 2
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def skip_boxes(regions: list[dict], width: float, height: float) -> list[list[float]]:
    """Boxes OCR must leave alone: math, code, tables and figures, but not the scan itself (most of the page)."""
    area = max(width * height, 1.0)
    out = []
    for region in regions:
        box = region.get("bbox")
        if region.get("kind") not in SKIPPED_KINDS or not box:
            continue
        if region["kind"] == "figure" and (box[2] - box[0]) * (box[3] - box[1]) >= policy.OCR_FULL_PAGE_FIGURE * area:
            continue
        out.append(box)
    return out


def clean_page(words: list[dict], width: float, height: float, skip: list[list[float]]) -> dict:
    """{text, words, paragraphs: [{text, bbox}], dropped} from posted words. Pure, deterministic."""
    kept, lines, dropped = [], defaultdict(list), 0
    slack = 2.0  # points: a box may touch the page edge
    for word in words:
        text, box = str(word.get("t") or "").strip(), word.get("b") or []
        ok = (0 < len(text) <= policy.OCR_MAX_WORD_CHARS and len(box) == 4
              and float(word.get("c") or 0) >= policy.OCR_MIN_CONFIDENCE
              and -slack <= box[0] <= box[2] <= width + slack and -slack <= box[1] <= box[3] <= height + slack
              and not any(_inside(box, s) for s in skip))
        if not ok:
            dropped += 1
            continue
        lines[(int(word.get("p") or 0), int(word.get("l") or 0))].append({**word, "t": text})
    paragraphs: dict[int, list] = defaultdict(list)
    for (para, _line), line_words in sorted(lines.items()):
        line_text = " ".join(w["t"] for w in line_words)
        if is_garbled(line_text):
            dropped += len(line_words)
            continue
        kept += line_words
        paragraphs[para].append((line_text, [w["b"] for w in line_words]))
    out_paragraphs = []
    for para in sorted(paragraphs):
        boxes = [b for _, line_boxes in paragraphs[para] for b in line_boxes]
        out_paragraphs.append({"text": "\n".join(text for text, _ in paragraphs[para]),
                               "bbox": [round(min(b[0] for b in boxes), 2), round(min(b[1] for b in boxes), 2),
                                        round(max(b[2] for b in boxes), 2), round(max(b[3] for b in boxes), 2)]})
    compact = [{"t": w["t"], "b": [round(float(v), 2) for v in w["b"]], "c": round(float(w.get("c") or 0), 1)}
               for w in kept]
    return {"text": "\n\n".join(p["text"] for p in out_paragraphs), "words": compact,
            "paragraphs": out_paragraphs, "dropped": dropped}


def region_rows(book: dict, page: int, paragraphs: list[dict], first_order: int) -> list[dict]:
    """page_regions rows (kind 'block', meta.source 'ocr') for a page's OCR paragraphs. Pure."""
    return [{"user_id": book["user_id"], "book_id": book["id"], "page": page, "kind": "block", "bbox": p["bbox"],
             "text": p["text"], "order_in_page": first_order + i, "meta": {"source": "ocr"}}
            for i, p in enumerate(paragraphs)]


def load_texts(book_id: str) -> dict[int, str]:
    """{page: OCR text} for the book; {} when there is none or migration 022 is not applied."""
    try:
        rows = supabase.table(TABLE).select("page, text").eq("book_id", book_id).execute().data or []
    except Exception as e:  # noqa: BLE001 - ingestion goes on with pypdf's text alone
        print(f"OCR text not read for book {book_id}: {e}")
        return {}
    return {int(row["page"]): row["text"] for row in rows if (row.get("text") or "").strip()}


def record_scanned(book_id: str, pages: list[int]) -> None:
    """books.scanned_pages (migration 022); a project without the column keeps the book, unflagged."""
    try:
        supabase.table("books").update({"scanned_pages": pages}).eq("id", book_id).execute()
    except Exception as e:  # noqa: BLE001 - only the flag is lost
        print(f"Scanned pages not recorded for book {book_id}: {e}")


def store_page(book: dict, page: int, cleaned: dict, engine: str) -> None:
    """Upsert the page's OCR row and replace its text regions with the OCR paragraphs."""
    confidences = [w["c"] for w in cleaned["words"]]
    supabase.table(TABLE).upsert({
        "book_id": book["id"], "user_id": book["user_id"], "page": page, "text": cleaned["text"],
        "words": cleaned["words"], "engine": engine[:60],
        "mean_confidence": round(sum(confidences) / len(confidences), 1) if confidences else None,
    }, on_conflict="book_id,page").execute()
    regions = supabase.table("page_regions").select("kind, order_in_page").eq("book_id", book["id"]).eq(
        "page", page).execute().data or []
    supabase.table("page_regions").delete().eq("book_id", book["id"]).eq("page", page).in_(
        "kind", list(TEXT_KINDS)).execute()
    kept = [r["order_in_page"] for r in regions if r["kind"] not in TEXT_KINDS]
    rows = region_rows(book, page, cleaned["paragraphs"], max(kept, default=-1) + 1)
    if rows:
        supabase.table("page_regions").insert(rows).execute()


def done_pages(book_id: str) -> list[int]:
    rows = supabase.table(TABLE).select("page").eq("book_id", book_id).execute().data or []
    return sorted({int(row["page"]) for row in rows})


def ready_to_reingest(book: dict, done: list[int]) -> bool:
    """A fully scanned book kept on the server, ready, with no chunks yet, whose every scanned page has text. Pure."""
    scanned = book.get("scanned_pages") or []
    return (bool(scanned) and book.get("status") == "ready" and not book.get("total_chunks")
            and book.get("storage_mode", "cloud") == "cloud" and set(scanned) <= set(done))
