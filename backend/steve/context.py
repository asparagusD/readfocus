"""Steve's context (C20.4, docs/STEVE.md S4): the one builder of what a question sends to Gemini.

build_context() returns the request's parts (delimited book text, an optional image, the question last) and a
citations map {label: anchor} for every page or section that was sent, so the panel can link "p. 112". In order:

1. the book card: title, author and as much of the contents as fits;
2. the current session's prose, verbatim (placeholders for equations, code and figures included), from the
   session's first chunk to the reader's place; over budget, the most recent part plus the passage around the
   anchor;
3. the highlighted passage and its paragraph, if an anchor is given (shown even when it is not found in the book,
   marked unverified: it is the reader's own selection);
4. the top-k passages from the whole book through the hybrid retriever, minus the chunks 2 and 3 already hold;
5. an optional region (an equation's source, exact code, a figure's caption) and image.

Everything is trimmed to policy.CONTEXT_MAX_TOKENS with a conservative token estimate; retrieved passages go
first, then the session's older text; the question, the selection and the region are never cut. Never the whole
book, never another reader's book, no user id or email. Book text cannot close the section it sits in.
"""

import asyncio
import hashlib
import math
import re
from dataclasses import dataclass, field

from backend.nlp import text as nlp_text
from backend.services import retriever
from backend.services.supabase_client import supabase
from backend.steve import policy

SECTION_TAGS = re.compile(
    r"<(?=\s*/?\s*(?:book_card|session_text|book_passage|highlight|selection|surrounding|retrieved|region|question)\b)",
    re.IGNORECASE)
SPINE_STEP = re.compile(r"^epubcfi\(/6/(\d+)")


class ContextError(Exception):
    """Why a context cannot be built: book_not_found, region_not_found, bad_image, empty_question,
    question_too_long."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class Passage:
    chunk_index: int | None
    label: str
    text: str
    citations: dict = field(default_factory=dict)  # label -> anchor, for the pages or sections it covers
    note: str = ""


@dataclass
class Highlight:
    label: str
    text: str
    surrounding: str
    verified: bool
    citations: dict = field(default_factory=dict)


@dataclass
class Region:
    kind: str
    label: str
    text: str
    citations: dict = field(default_factory=dict)
    language: str = ""


@dataclass
class Context:
    parts: list
    citations: dict
    book_card: str
    session: list
    highlight: Highlight | None
    retrieved: list
    region: Region | None
    tokens: int
    image_tokens: int
    context_hash: str


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(math.ceil(len(text) / policy.CHARS_PER_TOKEN), math.ceil(len(text.encode()) / policy.BYTES_PER_TOKEN))


def _fit(text: str, tokens: int) -> str:
    """The longest start of text whose estimate fits, cut at a space."""
    if estimate_tokens(text) <= tokens:
        return text
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        lo, hi = (mid, hi) if estimate_tokens(text[:mid] + " …") <= tokens else (lo, mid - 1)
    cut = text[:lo].rsplit(" ", 1)[0] if " " in text[:lo] else text[:lo]
    return cut + " …"


def _fit_end(text: str, tokens: int) -> str:
    """The longest end of text whose estimate fits, cut at a space."""
    if estimate_tokens(text) <= tokens:
        return text
    reversed_fit = _fit(text[::-1], tokens)
    tail = reversed_fit[::-1].lstrip("… ")
    return "… " + (tail.split(" ", 1)[1] if " " in tail else tail)


def _window(text: str, at: int, length: int, tokens: int) -> str:
    """About `tokens` of text centred on text[at:at+length]."""
    half = max(0, (tokens * policy.CHARS_PER_TOKEN - length) // 2)
    start, end = max(0, at - half), min(len(text), at + length + half)
    piece = ("… " if start else "") + text[start:end] + (" …" if end < len(text) else "")
    return _fit(piece, tokens)


def _safe(text: str) -> str:
    """Book text (and the question) can name our section tags but never open or close one."""
    return SECTION_TAGS.sub("‹", text or "")


def _norm(text: str) -> str:
    return " ".join((text or "").split())


def _find(haystack: str, needle: str) -> int:
    """Where needle occurs in haystack, whitespace-insensitively; -1 if not."""
    words = _norm(needle).split()
    if not words:
        return -1
    found = re.search(r"\s+".join(re.escape(w) for w in words), haystack)
    return found.start() if found else -1


def _spine_of_cfi(cfi: str) -> int | None:
    found = SPINE_STEP.match(cfi or "")
    return int(found.group(1)) // 2 - 1 if found else None


def _place(chunk: dict) -> tuple[str, dict]:
    """A chunk's label ("p. 44", "pp. 44-45", "sec. 3") and the citations it makes available."""
    anchors = chunk.get("anchors") or {}
    if anchors.get("kind") == "pdf" and anchors.get("pages"):
        first, last = anchors["pages"]
        cites = {f"p. {n}": {"kind": "pdf", "page": n} for n in range(first, last + 1)}
        return (f"p. {first}" if first == last else f"pp. {first}-{last}"), cites
    if anchors.get("kind") == "epub" and anchors.get("start"):
        start = anchors["start"]
        label = f"sec. {start['spine_index'] + 1}"
        return label, {label: {"kind": "epub", "spine_index": start["spine_index"], "cfi": start["cfi"]}}
    return f"part {chunk['chunk_index'] + 1}", {}


def _covers(chunk: dict, anchor: dict) -> bool:
    """Whether a chunk's place (pages, or spine items) holds an ANCHORS A1 anchor's page or spine item."""
    anchors = chunk.get("anchors") or {}
    if anchor.get("kind") == "pdf":
        pages = anchors.get("pages")
        return bool(pages) and pages[0] <= anchor.get("page", 0) <= pages[1]
    spine = _spine_of_cfi(anchor.get("cfi", ""))
    return spine is not None and bool(anchors.get("start")) and (
        anchors["start"]["spine_index"] <= spine <= anchors["end"]["spine_index"])


def _chunk_for_anchor(chunks: list[dict], anchor: dict) -> dict | None:
    """The chunk holding an anchor: by page or spine item, then the one whose text has the anchor's text."""
    candidates = [c for c in chunks if _covers(c, anchor)]
    with_text = [c for c in candidates if _find(_prose(c), anchor.get("text", "")) >= 0]
    return (with_text or candidates or [None])[0]


def _prose(chunk: dict) -> str:
    return chunk.get("prose") or chunk.get("content") or ""


# --- reading from the database (all filtered by book; the book by its owner) ------------------------------------

def _load(user_id: str, book_id: str, region_id: str | None) -> dict:
    book = supabase.table("books").select("id, title, author, toc, file_type").eq("id", book_id).eq(
        "user_id", user_id).execute().data
    if not book:
        raise ContextError("book_not_found")
    region = None
    if region_id:
        rows = supabase.table("page_regions").select("*").eq("id", region_id).eq("book_id", book_id).execute().data
        if not rows:
            raise ContextError("region_not_found")
        region = rows[0]
    sessions = supabase.table("sessions").select("chunk_start_index, chunk_end_index, status, started_at").eq(
        "user_id", user_id).eq("book_id", book_id).eq("status", "reading").order("started_at", desc=True).limit(
        1).execute().data or []
    progress = supabase.table("reading_progress").select("position").eq("user_id", user_id).eq(
        "book_id", book_id).execute().data or []
    return {"book": book[0], "region": region, "session": sessions[0] if sessions else None,
            "position": (progress[0].get("position") if progress else None) or {}}


def _chunks(book_id: str, indices) -> list[dict]:
    indices = sorted(set(indices))
    if not indices:
        return []
    rows = supabase.table("chunks").select("chunk_index, content, prose, anchors").eq("book_id", book_id).in_(
        "chunk_index", indices).execute().data or []
    return sorted(rows, key=lambda r: r["chunk_index"])


def _chunks_near(book_id: str, anchor: dict) -> list[dict]:
    """The chunks whose place holds an anchor: found by their anchors column, then only those read with text."""
    rows = supabase.table("chunks").select("chunk_index, anchors").eq("book_id", book_id).execute().data or []
    return _chunks(book_id, [r["chunk_index"] for r in rows if _covers(r, anchor)])


# --- the parts ----------------------------------------------------------------------------------------------------

def _book_card(book: dict) -> str:
    head = [f"Title: {_safe(book.get('title') or 'Untitled')}"]
    if book.get("author"):
        head.append(f"Author: {_safe(book['author'])}")
    lines, toc = [*head, "Contents:"], book.get("toc") or []
    for n, entry in enumerate(toc):
        where = f"p. {entry['page']}" if entry.get("page") else (
            f"sec. {entry['spine_index'] + 1}" if entry.get("spine_index") is not None else "")
        line = f"- {_safe(entry.get('title', ''))}" + (f" ({where})" if where else "")
        rest = f"… and {len(toc) - n} more entries"
        if estimate_tokens("\n".join([*lines, line, rest])) > policy.CARD_MAX_TOKENS:
            lines.append(rest)
            break
        lines.append(line)
    return "\n".join(lines if toc else head)


def _session(loaded: dict, book_id: str, anchor: dict | None, budget: int) -> list[Passage]:
    session, position = loaded["session"], loaded["position"]
    here = position.get("chunk_index")
    if session:
        first, last = session["chunk_start_index"], session["chunk_end_index"]
        if here is not None:
            last = min(last, max(first, here))
        indices = range(first, last + 1)
    else:
        indices = [here] if here is not None else []
    chunks = _chunks(book_id, indices)
    passages = []
    for chunk in chunks:
        label, cites = _place(chunk)
        passages.append(Passage(chunk["chunk_index"], label, _safe(_prose(chunk)), cites))
    if sum(estimate_tokens(p.text) for p in passages) <= budget:
        return passages
    keep, anchored = [], None  # over budget: the passage around the anchor, then the most recent text
    target = _chunk_for_anchor(chunks, anchor) if anchor else None
    if target is not None:
        source = next(p for p in passages if p.chunk_index == target["chunk_index"])
        at = _find(source.text, anchor.get("text", ""))
        anchored = Passage(source.chunk_index, source.label, _window(source.text, max(at, 0), len(anchor.get(
            "text", "")), policy.ANCHOR_WINDOW_TOKENS), source.citations, "around the highlighted passage")
        budget -= estimate_tokens(anchored.text)
    for passage in reversed(passages):
        cost = estimate_tokens(passage.text)
        if cost <= budget:
            keep.insert(0, passage)
            budget -= cost
            continue
        if budget > 20:
            keep.insert(0, Passage(passage.chunk_index, passage.label, _fit_end(passage.text, budget),
                                   passage.citations, "the most recent part"))
        break
    if anchored and not any(p.chunk_index == anchored.chunk_index and not p.note for p in keep):
        keep = sorted([anchored, *keep], key=lambda p: (p.chunk_index, p.note != anchored.note))
    return keep


def _session_range(loaded: dict) -> set:
    session = loaded["session"]
    return set(range(session["chunk_start_index"], session["chunk_end_index"] + 1)) if session else set()


def _highlight(book_id: str, anchor: dict) -> Highlight:
    selection = _norm(anchor.get("text", ""))
    chunk = _chunk_for_anchor(_chunks_near(book_id, anchor), anchor)
    if chunk is None:
        label, cites = (f"p. {anchor['page']}", {f"p. {anchor['page']}": {"kind": "pdf", "page": anchor["page"]}}) \
            if anchor.get("kind") == "pdf" and anchor.get("page") else ("the reader's selection", {})
        return Highlight(label, _safe(_fit(selection, 300)), "", False, cites)
    label, cites = _place(chunk)
    if anchor.get("kind") == "pdf" and anchor.get("page"):
        label, cites = f"p. {anchor['page']}", {f"p. {anchor['page']}": {"kind": "pdf", "page": anchor["page"]}}
    elif anchor.get("kind") == "epub" and _spine_of_cfi(anchor.get("cfi", "")) is not None:
        spine = _spine_of_cfi(anchor["cfi"])
        label = f"sec. {spine + 1}"
        cites = {label: {"kind": "epub", "spine_index": spine, "cfi": anchor["cfi"]}}
    prose = _prose(chunk)
    at = _find(prose, selection)
    if at < 0:
        return Highlight(label, _safe(_fit(selection, 300)), "", False, cites)
    start = prose.rfind("\n\n", 0, at) + 1 if prose.rfind("\n\n", 0, at) >= 0 else 0
    end = prose.find("\n\n", at)
    paragraph = prose[start:end if end >= 0 else len(prose)].strip()
    budget = policy.HIGHLIGHT_MAX_TOKENS - estimate_tokens(selection)
    if estimate_tokens(paragraph) > budget:
        paragraph = _window(paragraph, max(_find(paragraph, selection), 0), len(selection), budget)
    return Highlight(label, _safe(_fit(selection, 300)), _safe(paragraph), True, cites)


async def _retrieved(book_id: str, query: str, skip: set, budget: int) -> list[Passage]:
    found = await retriever.search(query, book_id, k=policy.RETRIEVE_CANDIDATES)
    order = [r["chunk_index"] for r in found if r["chunk_index"] not in skip][:policy.RETRIEVE_K]
    rows = {c["chunk_index"]: c for c in await asyncio.to_thread(_chunks, book_id, order)}
    terms = nlp_text.content_words(query)
    passages = []
    for index in order:
        chunk = rows.get(index)
        if chunk is None:
            continue
        prose = _prose(chunk)
        at = min((i for i in (prose.lower().find(t) for t in terms) if i >= 0), default=0)
        text = _safe(prose if estimate_tokens(prose) <= policy.PASSAGE_MAX_TOKENS else _window(
            prose, at, 0, policy.PASSAGE_MAX_TOKENS))
        if estimate_tokens(text) > budget:
            break
        label, cites = _place(chunk)
        passages.append(Passage(index, label, text, cites))
        budget -= estimate_tokens(text) + 12
    return passages


def _region(row: dict) -> Region:
    meta = row.get("meta") or {}
    if row.get("page"):
        label, cites = f"p. {row['page']}", {f"p. {row['page']}": {"kind": "pdf", "page": row["page"]}}
    else:
        spine = row.get("spine_index")
        label = f"sec. {spine + 1}" if spine is not None else "this passage"
        cites = {label: {"kind": "epub", "spine_index": spine, "cfi": (row.get("anchor") or {}).get("cfi")}} \
            if spine is not None else {}
    kind = row["kind"]
    if kind == "code":
        text = row.get("text") or ""
    elif kind == "math":
        text = meta.get("latex") or meta.get("mathml") or row.get("text") or "(drawn; see the image)"
    elif kind == "figure":
        text = "\n".join(v for v in (meta.get("label"), meta.get("caption"), meta.get("alt")) if v) or "(no caption)"
    elif kind == "table":
        text = "\n".join("\t".join(str(c) for c in r) for r in meta.get("rows") or []) or row.get("text") or ""
    else:
        text = row.get("text") or ""
    return Region(kind, label, _safe(_fit(text, policy.REGION_MAX_TOKENS)), cites, meta.get("language_guess") or "")


def _render(card: str, session: list, highlight, retrieved: list, region) -> str:
    out = [f"<book_card>\n{card}\n</book_card>"]
    if session:
        out.append("<session_text>\n" + "\n".join(
            f'<book_passage label="{p.label}"{f" note={chr(34)}{p.note}{chr(34)}" if p.note else ""}>\n{p.text}\n'
            "</book_passage>" for p in session) + "\n</session_text>")
    if highlight:
        out.append(f'<highlight label="{highlight.label}" verified="{"yes" if highlight.verified else "no"}">\n'
                   f"<selection>{highlight.text}</selection>\n"
                   + (f"<surrounding>\n{highlight.surrounding}\n</surrounding>\n" if highlight.surrounding else "")
                   + "</highlight>")
    if retrieved:
        out.append("<retrieved>\n" + "\n".join(
            f'<book_passage label="{p.label}">\n{p.text}\n</book_passage>' for p in retrieved) + "\n</retrieved>")
    if region:
        language = f' language="{region.language}"' if region.language else ""
        out.append(f'<region kind="{region.kind}" label="{region.label}"{language}>\n{region.text}\n</region>')
    return "\n".join(out)


def _image(image: dict | None) -> dict | None:
    if image is None:
        return None
    data, mime = image.get("data"), image.get("mime_type")
    if mime not in policy.IMAGE_TYPES or not isinstance(data, bytes | bytearray) or not data or len(
            data) > policy.IMAGE_MAX_BYTES:
        raise ContextError("bad_image")
    return {"inline_data": {"mime_type": mime, "data": bytes(data)}}


async def build_context(*, user_id: str, book_id: str, question: str, anchor: dict | None = None,
                        image: dict | None = None, region_id: str | None = None) -> Context:
    """Steve's grounded context for one question (see the module docstring). Raises ContextError."""
    question = _norm(question)
    if not question:
        raise ContextError("empty_question")
    if len(question) > policy.QUESTION_MAX_CHARS:
        raise ContextError("question_too_long")
    image_part = _image(image)
    loaded = await asyncio.to_thread(_load, user_id, book_id, region_id)
    question_part = f"<question>\n{_safe(question)}\n</question>"
    card = _book_card(loaded["book"])
    region = _region(loaded["region"]) if loaded["region"] else None
    highlight = await asyncio.to_thread(_highlight, book_id, anchor) if anchor else None
    image_tokens = policy.IMAGE_TOKENS if image_part else 0
    fixed = (estimate_tokens(_render(card, [], highlight, [], region)) + estimate_tokens(question_part)
             + image_tokens)
    session = await asyncio.to_thread(_session, loaded, book_id, anchor,
                                      min(policy.SESSION_MAX_TOKENS, policy.CONTEXT_MAX_TOKENS - fixed - 400))
    skip = {p.chunk_index for p in session} | _session_range(loaded)  # what the reader just read, even if trimmed
    if highlight and highlight.verified:
        near = _chunk_for_anchor(await asyncio.to_thread(_chunks_near, book_id, anchor), anchor)
        skip |= {near["chunk_index"]} if near else set()
    used = fixed + estimate_tokens(_render(card, session, highlight, [], region)) - estimate_tokens(
        _render(card, [], highlight, [], region))
    query = f"{question} {highlight.text}" if highlight else question
    retrieved = await _retrieved(book_id, query, skip, policy.CONTEXT_MAX_TOKENS - used - 100)
    while True:
        context_text = _render(card, session, highlight, retrieved, region)
        tokens = estimate_tokens(context_text) + estimate_tokens(question_part) + image_tokens
        if tokens <= policy.CONTEXT_MAX_TOKENS or not retrieved:
            break
        retrieved = retrieved[:-1]
    citations = {}
    for item in [*session, highlight, *retrieved, region]:
        if item is not None:
            citations.update(item.citations)
    digest = hashlib.sha256(context_text.encode())
    if image_part:
        digest.update(image_part["inline_data"]["data"])
    parts = [context_text, *([image_part] if image_part else []), question_part]
    return Context(parts, citations, card, session, highlight, retrieved, region, tokens, image_tokens,
                   digest.hexdigest())
