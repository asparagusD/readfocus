"""Structured blocks and a table of contents for the book reader (C12.1).

`chunks.content` stays exactly as `book_ingestor.chunk_text` makes it: the
agents quote it verbatim. The reader gets `chunks.blocks` beside it, an
ordered list of {id, type, text, marks} per chunk, and the book gets
`books.toc`, [{title, chunk_index, block_id}].

- EPUB: each document's XHTML is walked in the order ingestion reads it;
  h1-h6, p, blockquote and li become blocks, em/i and strong/b become
  marks, and only plain text is kept (no markup is stored; scripts and
  styles are skipped, images have no text). The blocks are then cut at the
  chunk boundaries by counting non-space characters, which both sides
  share; if they do not match, the chunk text is used instead.
- PDF (and that fallback): each chunk's text is rebuilt into paragraphs
  (wrapped lines joined, hyphenation mended, page numbers dropped) and
  chapter headings are guessed from short lines.

Pure apart from parsing the file; `build` never raises.
"""

import os
import re
import statistics
import tempfile

TYPES = ("chapter", "heading", "paragraph", "quote", "list_item")
HEADINGS = {f"h{n}": n for n in range(1, 7)}
BLOCK_TAGS = {"p", "div", "section", "article", "main", "header", "footer", "nav", "aside", "blockquote", "li",
              "ul", "ol", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "td", "th", "figure", "figcaption",
              "pre", "address", "hr", *HEADINGS}
SKIP_TAGS = {"script", "style", "template"}
MARK_TAGS = {"em": "em", "i": "em", "cite": "em", "strong": "strong", "b": "strong"}
TITLE_MAX = 120

NUMBER_WORDS = ("one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
                "sixteen|seventeen|eighteen|nineteen|twenty")
# The number must end the line or be followed by a space, ". ", ": " or a dash: not "01.qxd" or "5, as".
CHAPTER_RE = re.compile(rf"^(chapter|book|part)\s+(\d+|[ivxlcdm]+|{NUMBER_WORDS})(?=$|\s|[.:](\s|$)|[—–-])",
                        re.IGNORECASE)
BARE_CHAPTER_RE = re.compile(rf"^(chapter|book|part)\s+(\d+|[ivxlcdm]+|{NUMBER_WORDS})\.?$", re.IGNORECASE)
ROMAN_RE = re.compile(r"^[IVXLCDM]{1,7}\.?$")
CAPS_RE = re.compile(r"^[A-Z][A-Z'’&,\- ]*[A-Z]$")  # Latin capitals only: no digits, symbols or maths letters
HEAD_REPEATS = 3  # a page-edge line seen this often in a book is a running head or footer
PAGE_NUMBER_RE = re.compile(r"^(\d{1,4}|[ivxlcdm]{1,6})$")
ENDS_SENTENCE = tuple(".!?:\"”’)")


def skeleton(text: str) -> str:
    return "".join(ch for ch in text if not ch.isspace())


class _Run:
    """Text of one block with collapsed whitespace and merged mark ranges."""

    def __init__(self):
        self.text, self.marks, self.space = "", [], False

    def add(self, string: str, kinds) -> None:
        for piece in re.split(r"(\s+)", string.replace("\x00", "")):
            if not piece:
                continue
            if piece.isspace():
                self.space = bool(self.text)
                continue
            if self.space:
                self.text, self.space = self.text + " ", False
            start = len(self.text)
            self.text += piece
            for kind in sorted(kinds):
                last = next((m for m in reversed(self.marks) if m["kind"] == kind), None)
                if last and last["end"] >= start - 1:
                    last["end"] = len(self.text)
                else:
                    self.marks.append({"start": start, "end": len(self.text), "kind": kind})


def xhtml_blocks(markup) -> list[dict]:
    """Blocks of one XHTML body, each with a heading `level` (None for other types)."""
    from bs4 import BeautifulSoup
    from bs4.element import CData, NavigableString, Tag

    out, run = [], [_Run()]

    def flush(kind, level):
        if run[0].text:
            out.append({"type": kind, "level": level, "text": run[0].text,
                        "marks": sorted(run[0].marks, key=lambda m: (m["start"], m["kind"]))})
        run[0] = _Run()

    def walk(node, kind, level, kinds):
        for child in node.children:
            if isinstance(child, Tag):
                name = child.name.lower()
                if name in SKIP_TAGS:
                    continue
                if name == "br":
                    run[0].add(" ", kinds)
                elif name in BLOCK_TAGS:
                    flush(kind, level)
                    inner, inner_level = kind, level
                    if name in HEADINGS:
                        inner, inner_level = "heading", HEADINGS[name]
                    elif name == "li":
                        inner = "list_item"
                    elif name == "blockquote":
                        inner = "quote"
                    walk(child, inner, inner_level, kinds)
                    flush(inner, inner_level)
                else:
                    walk(child, kind, level, kinds | ({MARK_TAGS[name]} if name in MARK_TAGS else set()))
            elif type(child) in (NavigableString, CData):  # what get_text() keeps, nothing else
                run[0].add(str(child), kinds)

    walk(BeautifulSoup(markup, "html.parser"), "paragraph", None, frozenset())
    flush("paragraph", None)
    return out


def epub_documents(file_bytes: bytes) -> list:
    """Body markup of each EPUB document, in the order `extract_text_from_epub` reads them."""
    import ebooklib
    from ebooklib import epub

    with tempfile.NamedTemporaryFile(delete=False, suffix=".epub") as temp_file:
        temp_file.write(file_bytes)
        path = temp_file.name
    try:
        book = epub.read_epub(path)
        return [item.get_body_content() for item in book.get_items() if item.get_type() == ebooklib.ITEM_DOCUMENT]
    finally:
        os.remove(path)


def epub_blocks(file_bytes: bytes) -> list[dict]:
    """The book's blocks; the top heading level used more than once is the chapter level."""
    blocks = [block for markup in epub_documents(file_bytes) for block in xhtml_blocks(markup)]
    levels = [b["level"] for b in blocks if b["type"] == "heading"]
    repeated = [level for level in set(levels) if levels.count(level) > 1]
    chapter_level = min(repeated or levels or [0])
    for block in blocks:
        if block.pop("level") == chapter_level and block["type"] == "heading":
            block["type"] = "chapter"
    return blocks


def _cut(text: str, marks: list, count: int):
    """Split a block after `count` non-space characters; marks are clipped and shifted."""
    seen = index = 0
    while seen < count:
        seen += not text[index].isspace()
        index += 1
    head, tail = text[:index].rstrip(), text[index:].lstrip()
    shift = len(text) - len(tail)
    head_marks = [{**m, "end": min(m["end"], len(head))} for m in marks if m["start"] < len(head)]
    tail_marks = [{**m, "start": max(m["start"] - shift, 0), "end": m["end"] - shift}
                  for m in marks if m["end"] > shift]
    return (head, head_marks), (tail, tail_marks)


def assign(blocks: list[dict], chunks: list[str]):
    """Cut the book's blocks at the chunk boundaries, or None when the texts do not match."""
    if skeleton("".join(b["text"] for b in blocks)) != skeleton("".join(chunks)):
        return None
    ends, total = [], 0
    for content in chunks:
        total += len(skeleton(content))
        ends.append(total)
    out, index, pos = [[] for _ in chunks], 0, 0
    for block in blocks:
        text, marks, continued = block["text"], block["marks"], False
        while text:
            while pos >= ends[index]:
                index += 1
            size, room = len(skeleton(text)), ends[index] - pos
            piece = (text, marks) if size <= room else None
            if piece is None:
                piece, (text, marks) = _cut(text, marks, room)
            out[index].append({"type": block["type"], "text": piece[0], "marks": piece[1],
                               **({"continued": True} if continued else {})})
            pos += min(size, room)
            if size <= room:
                break
            continued = True
    return out


def _roman(numeral: str) -> int:
    values = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    digits = [values[ch] for ch in numeral.lower()]
    return sum(-d if i + 1 < len(digits) and d < digits[i + 1] else d for i, d in enumerate(digits))


def _chapter_roman(numeral: str) -> bool:
    """A numeral a chapter would carry: written the standard way and under 100 (not VDD, VCC, CL or MIX)."""
    value = _roman(numeral)
    if not 0 < value < 100:
        return False
    out = ""
    for amount, letters in ((90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        count, value = divmod(value, amount)
        out += letters * count
    return out == numeral.upper()


def _number(token: str) -> int:
    token = token.lower().rstrip(".")
    if token.isdigit():
        return int(token)
    words = NUMBER_WORDS.split("|")
    return words.index(token) + 1 if token in words else _roman(token)


def _prose(line: str) -> bool:
    return len(line.split()) >= 4 and any(ch.islower() for ch in line)


def _chapter_key(line: str, following: str = "", need_prose: bool = True):
    """('n', number) or ('t', text) when the line reads as a chapter heading, else None."""
    if len(line) > 60 or len(line.split()) > 8 or line.endswith((",", ";", ".", ":")) and not ROMAN_RE.match(line):
        return None
    if match := CHAPTER_RE.match(line):
        return "n", _number(match.group(2))
    if ROMAN_RE.match(line):  # a title or prose follows a chapter numeral; a variable (X, V) is followed by maths
        words_follow = not need_prose or any(ch.islower() for ch in following)
        return ("n", _roman(line.rstrip("."))) if _chapter_roman(line.rstrip(".")) and words_follow else None
    words = re.findall(r"[A-Z]+", line)
    if CAPS_RE.match(line) and any(len(word) >= 4 for word in words) and (_prose(following) or not need_prose):
        return "t", line
    return None


def _head_key(line: str):
    """A running head's identity: case and spacing ignored, a page number at either end dropped."""
    if len(line) < 8 or len(line.split()) < 2:
        return None
    key = re.sub(r"\s+", " ", line.lower())
    return key if BARE_CHAPTER_RE.match(line) else re.sub(r"^\d+\s+|\s*\d+$", "", key)


def _edges(content: str):
    for segment in re.split(r"\n\s*\n", content):
        lines = [line.strip() for line in segment.split("\n") if line.strip()]
        yield from {lines[0], lines[-1]} if lines else ()


def running_heads(chunks: list[str]) -> set:
    """Keys of lines that start or end a page (a blank-line segment) at least HEAD_REPEATS times in the book."""
    counts: dict = {}
    for content in chunks:
        for line in _edges(content):
            if key := _head_key(line):
                counts[key] = counts.get(key, 0) + 1
    return {key for key, count in counts.items() if count >= HEAD_REPEATS}


def _join(text: str, line: str) -> str:
    if not text:
        return line
    if text.endswith("-") and text[-2:-1].isalpha():
        return text[:-1] + line if line[:1].islower() else text + line
    return f"{text} {line}"


def _open_end(text: str) -> bool:
    return not text.endswith(ENDS_SENTENCE)


def text_blocks(content: str, previous: dict | None = None, book: dict | None = None) -> list[dict]:
    """Paragraphs and guessed headings of one chunk's text (PDF, or EPUB fallback).

    `book` carries what one chunk cannot know: the running heads of the whole book (`heads`) and the
    chapters already found (`seen`), so a repeated head becomes one chapter and a number is listed once.
    """
    book = book if book is not None else {"heads": set(), "seen": set()}
    edges = set(_edges(content))
    lines = [line.strip() for line in content.split("\n")]
    lines = ["" if PAGE_NUMBER_RE.match(line) else line for line in lines]
    long_lines = [len(line) for line in lines if len(line) >= 20]
    typical = statistics.median(long_lines) if long_lines else 0
    blocks, text, after_break = [], "", True  # after_break: the last line ended a paragraph or a heading
    page_break = False  # a blank line inside an open sentence: the text may go on, or a chapter may start

    def close(kind="paragraph"):
        nonlocal text
        if text:
            blocks.append({"type": kind, "text": text, "marks": []})
        text = ""

    for i, line in enumerate(lines):
        if not line:
            if text and _open_end(text):  # a page break inside a sentence: keep going
                page_break = True
                continue
            close()
            after_break = True
            continue
        was_break, page_break = page_break, False
        if line in edges and _head_key(line) in book["heads"]:  # page furniture: not part of the text
            key = _chapter_key(line, need_prose=False)
            if key and key not in book["seen"]:  # some books mark a chapter only in its running head
                book["seen"].add(key)
                close()
                title = line if BARE_CHAPTER_RE.match(line) else re.sub(r"^\d+\s+|\s*\d+$", "", line)
                blocks.append({"type": "chapter", "text": title, "marks": []})
                after_break = True
            continue
        following = next((later for later in lines[i + 1:] if later), "")
        last = blocks[-1] if blocks and not text else None
        key = _chapter_key(line, following) if (after_break or was_break) and following else None
        if key and key not in book["seen"] and not _chapter_key(following, need_prose=False):
            book["seen"].add(key)
            close()
            blocks.append({"type": "chapter", "text": line, "marks": []})
            continue
        if last and last["type"] == "chapter" and following and len(line.split()) <= 8 and len(line) <= 60 \
                and _open_end(line) and (BARE_CHAPTER_RE.match(last["text"]) or ROMAN_RE.match(last["text"])):
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
        blocks = None
        if file_type.lower() == "epub":
            try:
                blocks = assign(epub_blocks(file_bytes), chunks)
            except Exception as e:  # noqa: BLE001 - an EPUB we cannot walk still gets text blocks
                print(f"EPUB structure not read: {e}")
        if blocks is None:
            blocks, book = [], {"heads": running_heads(chunks), "seen": set()}
            for content in chunks:
                blocks.append(text_blocks(content, blocks[-1][-1] if blocks and blocks[-1] else None, book))
        for chunk_index, chunk in enumerate(blocks):
            for n, block in enumerate(chunk):
                chunk[n] = {"id": f"{chunk_index}.{n}", **block}
        return blocks, contents(blocks)
    except Exception as e:  # noqa: BLE001 - structure is for display; ingestion must not fail on it
        print(f"Book structure not built: {e}")
        return None, None
