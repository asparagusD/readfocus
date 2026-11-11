"""Structured blocks and a table of contents for the book reader (C12.1).

`chunks.content` stays exactly as `book_ingestor.chunk_text` makes it: the
agents quote it verbatim. The reader gets `chunks.blocks` beside it, an
ordered list of {id, type, text, marks} per chunk, and the book gets
`books.toc`, [{title, chunk_index, block_id}].

- PDF (and, until the EPUB tags are read, EPUB): each chunk's text is
  rebuilt into paragraphs (wrapped lines joined, hyphenation mended, page
  numbers dropped) and chapter headings are guessed from short lines.

Pure; `build` never raises.
"""

import re
import statistics

TYPES = ("chapter", "heading", "paragraph", "quote", "list_item")
TITLE_MAX = 120

NUMBER_WORDS = ("one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
                "sixteen|seventeen|eighteen|nineteen|twenty")
CHAPTER_RE = re.compile(rf"^(chapter|book|part)\s+(\d+|[ivxlcdm]+|{NUMBER_WORDS})\b", re.IGNORECASE)
ROMAN_RE = re.compile(r"^[IVXLCDM]{1,7}\.?$")
PAGE_NUMBER_RE = re.compile(r"^(\d{1,4}|[ivxlcdm]{1,6})$")
ENDS_SENTENCE = tuple(".!?:\"”’)")


def skeleton(text: str) -> str:
    return "".join(ch for ch in text if not ch.isspace())


def _is_heading_line(line: str) -> bool:
    if len(line) > 60 or len(line.split()) > 8 or line.endswith((",", ";", ".", ":")) and not ROMAN_RE.match(line):
        return False
    letters = [ch for ch in line if ch.isalpha()]
    return bool(CHAPTER_RE.match(line) or ROMAN_RE.match(line) or len(letters) >= 3 and line == line.upper())


def _join(text: str, line: str) -> str:
    if not text:
        return line
    if text.endswith("-") and text[-2:-1].isalpha():
        return text[:-1] + line if line[:1].islower() else text + line
    return f"{text} {line}"


def _open_end(text: str) -> bool:
    return not text.endswith(ENDS_SENTENCE)


def text_blocks(content: str, previous: dict | None = None) -> list[dict]:
    """Paragraphs and guessed headings of one chunk's text (PDF, or EPUB fallback)."""
    lines = [line.strip() for line in content.split("\n")]
    lines = ["" if PAGE_NUMBER_RE.match(line) else line for line in lines]
    long_lines = [len(line) for line in lines if len(line) >= 20]
    typical = statistics.median(long_lines) if long_lines else 0
    blocks, text, after_break = [], "", True  # after_break: the last line ended a paragraph or a heading

    def close(kind="paragraph"):
        nonlocal text
        if text:
            blocks.append({"type": kind, "text": text, "marks": []})
        text = ""

    for i, line in enumerate(lines):
        if not line:
            if text and _open_end(text):  # a page break inside a sentence: keep going
                continue
            close()
            after_break = True
            continue
        following = next((later for later in lines[i + 1:] if later), "")
        last = blocks[-1] if blocks and not text else None
        if after_break and following and _is_heading_line(line) and not _is_heading_line(following):
            close()
            blocks.append({"type": "chapter", "text": line, "marks": []})
            continue
        if last and last["type"] == "chapter" and following and len(line.split()) <= 8 and len(line) <= 60 \
                and _open_end(line):
            blocks.append({"type": "heading", "text": line, "marks": []})
            continue
        text = _join(text, line)
        after_break = not _open_end(line) and typical >= 40 and len(line) < 0.7 * typical
        if after_break:
            close()
    close()
    if blocks and previous and previous["type"] == "paragraph" and _open_end(previous["text"]) \
            and blocks[0]["type"] == "paragraph" and blocks[0]["text"][:1].islower():
        blocks[0]["continued"] = True
    return blocks


def contents(blocks: list[list[dict]]) -> list[dict]:
    """Table of contents: every chapter block, with the heading right after it as its title."""
    toc = []
    for chunk_index, chunk in enumerate(blocks):
        for n, block in enumerate(chunk):
            if block["type"] != "chapter" or block.get("continued"):
                continue
            title = block["text"]
            if n + 1 < len(chunk) and chunk[n + 1]["type"] == "heading":
                title = f"{title}: {chunk[n + 1]['text']}"
            toc.append({"title": title[:TITLE_MAX], "chunk_index": chunk_index, "block_id": block["id"]})
    return toc


def build(file_type: str, file_bytes: bytes, chunks: list[str]):
    """(blocks per chunk, toc) for a book's chunks, or (None, None) if anything goes wrong."""
    try:
        blocks = []
        for content in chunks:
            blocks.append(text_blocks(content, blocks[-1][-1] if blocks and blocks[-1] else None))
        for chunk_index, chunk in enumerate(blocks):
            for n, block in enumerate(chunk):
                chunk[n] = {"id": f"{chunk_index}.{n}", **block}
        return blocks, contents(blocks)
    except Exception as e:  # noqa: BLE001 - structure is for display; ingestion must not fail on it
        print(f"Book structure not built: {e}")
        return None, None
