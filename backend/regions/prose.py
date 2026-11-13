"""Prose-only text for the agents, with anchored placeholders (C18.6). Pure: no I/O.

`chunks.content` stays exactly as ingestion makes it (evidence and the
reader's blocks are cut from it). Beside it each chunk gets `prose`: the same
text with every math, code, figure and table region replaced by one
placeholder that says what it was and where ("[Equation 3.2, p. 45]",
"[Code listing, p. 46]", "[Figure 3.4: <caption or alt>, p. 47]";
"sec. N" for an EPUB spine document), and `anchors`: the chunk's place in the
book (PDF pages and per-page character spans; EPUB start and end CFIs with
A4 locations) and the placeholders it holds, so quizzes, focus ranges and
Steve can cite them.

Both sides are lined up by non-space characters ("skeleton" positions):
the chunks' skeletons concatenate to the book's, as `book_structure.assign`
relies on. Spans of the book that are not prose are found per PDF page (a
pypdf line belongs to a non-prose region when its text is inside that
region's, inline math by its text and context) or per EPUB block (by the
element path that `chunks.block_paths` and `page_regions.anchor` share).
"""

import bisect
import re

from backend.regions import policy
from backend.regions.garble import is_garbled

NON_PROSE = ("math", "code", "figure", "table")
PROSE_KINDS = ("block", "prose")
PLACEHOLDER = re.compile(r"\[(?:Equation|Code listing|Figure|Table|Unreadable text)\b[^\[\]]*, (?:p|sec)\. \d+\]")
CAPTION_LABEL = re.compile(policy.CAPTION_PATTERN)
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
# A placeholder holds "p. 45", which a sentence splitter would end a sentence at: it is masked first.
MASK = "[placeholder]"


def skeleton(text: str) -> str:
    return "".join(ch for ch in text if not ch.isspace())


def _caption(region: dict) -> str | None:
    meta = region.get("meta") or {}
    text = " ".join((meta.get("caption") or meta.get("alt") or "").split())
    label = meta.get("label")
    if label and text.startswith(label):
        text = text[len(label):].lstrip(" .:—–-")
    text = text.replace("[", "(").replace("]", ")")
    if len(text) > policy.PLACEHOLDER_CAPTION_MAX:
        text = text[:policy.PLACEHOLDER_CAPTION_MAX].rsplit(" ", 1)[0] + "…"
    return text or None


def placeholder(region: dict, where: str) -> str:
    """"[Equation 3.2, p. 45]", "[Code listing, p. 46]", "[Figure 3.4: caption, p. 47]", "[Table 1, sec. 2]"."""
    kind, meta = region["kind"], region.get("meta") or {}
    if kind == "math":
        number = meta.get("equation_number")
        return f"[Equation {number}, {where}]" if number else f"[Equation, {where}]"
    if kind == "code":
        return f"[Code listing, {where}]"
    name = meta.get("label") or ("Table" if kind == "table" else "Figure")
    caption = _caption(region)
    return f"[{name}: {caption}, {where}]" if caption else f"[{name}, {where}]"


def apply(content: str, start: int, spans: list[dict]) -> tuple[str, list[dict]]:
    """`content` (starting at book skeleton position `start`) with each span's characters replaced by its
    placeholder, written once per region; whitespace outside spans kept as it is. Returns (text, spans used)."""
    text, used, _at = _apply(content, start, spans)
    return text, used


def _apply(content: str, start: int, spans: list[dict]) -> tuple[str, list[dict], list]:
    """apply(), and for each character of the text its book skeleton position (None for spaces and placeholders)."""
    out, used, seen, pending, at = [], [], set(), "", []
    spans = sorted(spans, key=lambda s: s["start"])
    pos, i, inside = start, 0, False
    for ch in content:
        if ch.isspace():
            if inside:
                pending += ch
            else:
                out.append(ch)
                at.append(None)
            continue
        while i < len(spans) and spans[i]["end"] <= pos:
            i += 1
        span = spans[i] if i < len(spans) and spans[i]["start"] <= pos else None
        if span is not None:
            if not inside and out and not out[-1][-1:].isspace() and id(span["region"]) not in seen:
                out.append(" ")
                at.append(None)
            if id(span["region"]) not in seen:
                seen.add(id(span["region"]))
                used.append(span)
                out.append(span["text"])
                at += [None] * len(span["text"])
            inside, pending = True, ""
        else:
            if inside and pending and out and not out[-1][-1:].isspace():
                out.append("\n" if "\n" in pending else " ")
                at.append(None)
            inside, pending = False, ""
            out.append(ch)
            at.append(pos)
        pos += 1
    return "".join(out), used, at


def _garbled(sentence: str) -> bool:
    """A sentence's own text (placeholders left out) is garbled as printed or with its lines joined."""
    own = PLACEHOLDER.sub(" ", sentence)
    return bool(own.strip()) and (is_garbled(own) or is_garbled(" ".join(own.split())))


def unreadable(text: str, at: list, where) -> tuple[str, list[tuple[str, int]]]:
    """Each garbled sentence of `text` as "[Unreadable text, <where(position)>]", the placeholders it held kept
    after it. Sentences end at . ! ? and a space, never inside a placeholder. Returns (text, [(placeholder,
    book position)])."""
    inside = [m.span() for m in PLACEHOLDER.finditer(text)]
    cuts = [m.end() for m in SENTENCE_END.finditer(text) if not any(s < m.start() < e for s, e in inside)]
    out, found, begin = [], [], 0
    for end in [*cuts, len(text)]:
        piece = text[begin:end]
        body = piece.rstrip()
        if body and _garbled(body):
            position = next((p for p in at[begin:end] if p is not None), None)
            mark = f"[Unreadable text, {where(position)}]"
            out.append(" ".join([mark, *PLACEHOLDER.findall(body)]) + piece[len(body):])
            found.append((mark, position))
        else:
            out.append(piece)
        begin = end
    return "".join(out), found


def _merge(spans: list[dict]) -> list[dict]:
    """Touching spans of one region become one; a span overlapping an earlier one is dropped."""
    merged: list[dict] = []
    for span in sorted(spans, key=lambda s: (s["start"], -s["end"])):
        if merged and span["start"] < merged[-1]["end"]:
            continue
        if merged and merged[-1]["region"] is span["region"] and merged[-1]["end"] == span["start"]:
            merged[-1] = {**merged[-1], "end": span["end"]}
        else:
            merged.append(span)
    return merged


# --- PDF -------------------------------------------------------------------------------------

def _region_skeleton(region: dict) -> str:
    labels = (region.get("meta") or {}).get("labels") or []
    return skeleton(region.get("text") or "") + "".join(skeleton(label) for label in labels)


def _line_region(line: str, others: list[tuple[dict, str]], prose: list[str]):
    from rapidfuzz import fuzz

    in_prose = any(line in text for text in prose)
    for region, text in others:
        if line in text and (len(line) >= policy.PROSE_EXCLUSIVE_MIN or not in_prose):
            return region
    if len(line) >= policy.PROSE_FUZZY_MIN and not in_prose:
        for region, text in others:
            if text and fuzz.partial_ratio(line, text) >= policy.PROSE_FUZZY_RATIO:
                return region
    return None


def _inline_math(page_skeleton: str, region: dict) -> list[tuple[int, int]]:
    """Where the block's inline math ranges sit in the page's skeleton, found by text and context."""
    found, text, n = [], region.get("text") or "", policy.PROSE_INLINE_CONTEXT
    for start, end in (region.get("meta") or {}).get("inline_math") or []:
        math = skeleton(text[start:end])
        before, after = skeleton(text[:start])[-n:], skeleton(text[end:])[:n]
        if not math:
            continue
        for head, tail in ((before, after), (before, ""), ("", after)):
            at = page_skeleton.find(head + math + tail) if head or tail else -1
            if at >= 0:
                found.append((at + len(head), at + len(head) + len(math)))
                break
    return found


def page_spans(page_text: str, page: int, regions: list[dict]) -> list[dict]:
    """Non-prose spans of one PDF page, in the page's skeleton positions."""
    others = [(r, _region_skeleton(r)) for r in regions if r["kind"] in NON_PROSE]
    prose = [skeleton(r.get("text") or "") for r in regions if r["kind"] in PROSE_KINDS]
    lines, offset = [], 0
    for line in page_text.split("\n"):
        text = skeleton(line)
        if text:
            lines.append([offset, offset + len(text), text, _line_region(text, others, prose) if others else None])
        offset += len(text)
    for order in (range(len(lines)), range(len(lines) - 1, -1, -1)):  # short labels go with a region beside them
        for n in order:
            line = lines[n]
            if line[3] is not None or len(line[2]) > policy.PROSE_SANDWICH_MAX:
                continue
            for near in (lines[n - 1] if n else None, lines[n + 1] if n + 1 < len(lines) else None):
                if near and near[3] is not None and line[2] in _region_skeleton(near[3]):
                    line[3] = near[3]
                    break
    where = f"p. {page}"
    spans = [{"start": s, "end": e, "region": r, "text": placeholder(r, where)} for s, e, _, r in lines if r]
    whole = "".join(line[2] for line in lines)
    for region in regions:
        if region["kind"] in PROSE_KINDS:
            inline = {"kind": "math", "page": page, "order_in_page": region.get("order_in_page"), "meta": {}}
            for s, e in _inline_math(whole, region):
                spans.append({"start": s, "end": e, "region": {**inline}, "text": placeholder(inline, where)})
    return _merge(spans)


def _ranges(chunks: list[str]) -> list[tuple[int, int]]:
    out, total = [], 0
    for content in chunks:
        size = len(skeleton(content))
        out.append((total, total + size))
        total += size
    return out


def pdf_prose(chunks: list[str], page_texts: list[str], regions: list[dict]) -> list[dict]:
    """Per chunk {prose, anchors} for a PDF: `page_texts` are pypdf's, one per page (empty pages included)."""
    by_page: dict[int, list[dict]] = {}
    for region in regions:
        if region.get("page"):
            by_page.setdefault(region["page"], []).append(region)
    starts, spans, total = [], [], 0
    for number, text in enumerate(page_texts, start=1):
        starts.append(total)
        for span in page_spans(text, number, sorted(by_page.get(number, []), key=lambda r: r["order_in_page"])):
            spans.append({**span, "start": span["start"] + total, "end": span["end"] + total, "page": number})
        total += len(skeleton(text))
    def page_at(position):  # the page holding a book skeleton position
        return bisect.bisect_right(starts, position or 0) if starts else None

    out = []
    for content, (start, end) in zip(chunks, _ranges(chunks)):
        text, used, at = _apply(content, start, spans)
        text, bad = unreadable(text, at, lambda p: f"p. {page_at(p)}")
        pieces = [{"page": n + 1, "char_start": max(start, s) - s, "char_end": min(end, e) - s}
                  for n, (s, e) in enumerate(zip(starts, [*starts[1:], total])) if s < end and e > start and e > s]
        marks = [{"kind": u["region"]["kind"], "text": u["text"], "page": u["page"],
                  "order": u["region"].get("order_in_page"), "at": u["start"]} for u in used]
        marks += [{"kind": "unreadable", "text": mark, "page": page_at(p), "order": None, "at": p or 0} for mark, p in bad]
        out.append({"prose": text, "garbled": len(bad), "anchors": {
            "kind": "pdf", "pages": [pieces[0]["page"], pieces[-1]["page"]] if pieces else None, "spans": pieces,
            "placeholders": [{k: v for k, v in m.items() if k != "at"} for m in sorted(marks, key=lambda m: m["at"])]}})
    return out


# --- EPUB ------------------------------------------------------------------------------------

def _steps(path: str) -> list[int]:
    return [int(s) for s in (path or "").split("/") if s]


def _gaps(block: str, region: dict) -> list[tuple[int, int]]:
    """Where a prose region's inline math sits in its block's skeleton: the gaps between its prose pieces."""
    text, ranges = region.get("text") or "", (region.get("meta") or {}).get("inline_math") or []
    if not ranges:
        return []
    pieces, cursor = [], 0
    for start, end in ranges:
        pieces.append(skeleton(text[cursor:start]))
        cursor = end
    pieces.append(skeleton(text[cursor:]))
    out, pos = [], 0
    for n, piece in enumerate(pieces):
        at = block.find(piece, pos) if piece else (len(block) if n == len(pieces) - 1 else pos)
        if at < 0:
            return []
        if n:
            out.append((pos, at))
        pos = at + len(piece)
    return [(s, e) for s, e in out if e > s]


def _cfi(spine: int, path: str) -> str:
    return f"epubcfi(/6/{2 * (spine + 1)}!{path})"


def epub_prose(chunks: list[str], blocks, paths, regions: list[dict]) -> list[dict]:
    """Per chunk {prose, anchors} for an EPUB from its blocks and block paths; content as it is without them."""
    if not blocks or not paths:
        return [{"prose": content, "garbled": 0, "anchors": None} for content in chunks]
    by_spine: dict[int, list[dict]] = {}
    for region in regions:
        by_spine.setdefault(region.get("spine_index"), []).append(region)
    spans, places, pos, done, owners = [], [], 0, {}, []  # done: skeleton characters seen per spine document
    for chunk_blocks, chunk_paths in zip(blocks, paths):
        first = last = None
        for block, place in zip(chunk_blocks, chunk_paths):
            spine, path, text = place["spine_index"], place["path"], skeleton(block["text"])
            if spine is not None:  # a document outside the spine has text but no place to anchor to
                owners.append((pos, spine))
                location = spine * 1_000_000 + min(done.get(spine, 0), 999_999)
                last = {"spine_index": spine, "cfi": _cfi(spine, path), "location": location}
                first = first or last
                done[spine] = done.get(spine, 0) + len(text)
            here = by_spine.get(spine, []) if spine is not None and path else []
            mine, prose_here = None, [r for r in here if r["kind"] in PROSE_KINDS]
            for region in here:
                inner = _steps(region["anchor"]["path"])
                if region["kind"] not in NON_PROSE:
                    continue
                if _steps(path)[:len(inner)] == inner or (
                        inner[:len(_steps(path))] == _steps(path)
                        and not any(_steps(p["anchor"]["path"])[:len(_steps(path))] == _steps(path) for p in prose_here)):
                    mine = region
                    break
            where = f"sec. {spine + 1}" if spine is not None else ""
            if mine is not None and text:
                spans.append({"start": pos, "end": pos + len(text), "region": mine, "text": placeholder(mine, where)})
            for region in prose_here:
                if region["anchor"]["path"] == path:
                    for s, e in _gaps(text, region):
                        inline = {"kind": "math", "spine_index": spine, "order_in_page": region.get("order_in_page"),
                                  "anchor": region["anchor"], "meta": {}}
                        spans.append({"start": pos + s, "end": pos + e, "region": inline,
                                      "text": placeholder(inline, where)})
            pos += len(text)
        places.append((first, last))
    spans = _merge(spans)
    keys = [p for p, _ in owners]

    def spine_at(position):  # the spine document holding a book skeleton position
        n = bisect.bisect_right(keys, position or 0) - 1
        return owners[n][1] if n >= 0 else None

    out = []
    for content, (start, _end), (first, last) in zip(chunks, _ranges(chunks), places):
        text, used, at = _apply(content, start, spans)
        text, bad = unreadable(text, at, lambda p: f"sec. {(spine_at(p) or 0) + 1}")
        marks = [{"kind": u["region"]["kind"], "text": u["text"], "spine_index": u["region"].get("spine_index"),
                  "order": u["region"].get("order_in_page"), "cfi": (u["region"].get("anchor") or {}).get("cfi"),
                  "at": u["start"]} for u in used]
        marks += [{"kind": "unreadable", "text": mark, "spine_index": spine_at(p), "order": None, "cfi": None,
                   "at": p or 0} for mark, p in bad]
        out.append({"prose": text, "garbled": len(bad), "anchors": {
            "kind": "epub", "start": first, "end": last,
            "placeholders": [{k: v for k, v in m.items() if k != "at"} for m in sorted(marks, key=lambda m: m["at"])]}})
    return out


# --- sentences -----------------------------------------------------------------------------------

def mask(text: str) -> str:
    """Each placeholder as MASK, so sentence splitting does not stop inside it."""
    return PLACEHOLDER.sub(MASK, text)


def sentence_counts(text: str) -> dict:
    """How many sentences of a chunk's prose are garbled, and how many hold a placeholder."""
    counts = {"garbled": 0, "placeholder": 0}
    for sentence in SENTENCE_END.split(mask(text or "")):
        if MASK in sentence:
            counts["placeholder"] += 1
        elif sentence.strip() and is_garbled(sentence):
            counts["garbled"] += 1
    return counts
