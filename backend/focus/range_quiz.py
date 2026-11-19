"""The bookmark-range quiz, pure parts (C23.5, docs/FOCUS_RULES.md F10-F12, docs/ANCHORS.md A6). No I/O.

A session's range runs from its start place to its bookmark. It is cut into slices, one per chunk it touches:
the fraction [lo, hi) of the chunk's text inside the range and the prose words there (placeholders such as
"[Equation 3.2, p. 45]" do not count). A PDF is sliced by pages (chunks.anchors spans), an EPUB by blocks
(chunks.blocks and block_paths), and a book without either by its contents' chapters (whole chunks). A bank
question sits in the range where its evidence is in its chunk. `select` takes clamp(round(words / 400), 3, 15)
questions spread across equal strata of the range, honouring the question mix, then preferring unused,
difficulty-matched, better questions; one sentence or answer is never asked twice.
"""

from math import floor

from pydantic import BaseModel

from backend.agents import policy
from backend.agents.question_generation.assembler import BankQuestion
from backend.regions.prose import PLACEHOLDER
from backend.services.book_structure import block_for_cfi

BLOCK_JOIN = "\n\n"


def question_count(words: float) -> int:
    """F10: clamp(round(words / 400), 3, 15), halves rounded up."""
    n = floor(words / policy.QUIZ_WORDS_PER_QUESTION + 0.5)
    return max(policy.QUIZ_MIN_QUESTIONS, min(policy.QUIZ_MAX_QUESTIONS, n))


def prose_words(text: str | None) -> int:
    return len(PLACEHOLDER.sub(" ", text or "").split())


class Slice(BaseModel):
    chunk_index: int
    lo: float
    hi: float
    words: float


def _chunk_text(chunk: dict) -> str:
    return chunk.get("prose") or chunk.get("content") or ""


def pdf_slices(chunks: list[dict], first_page: int, last_page: int) -> list[Slice]:
    """Pages first..last of each chunk, by its anchors' spans (characters per page), in chunk order."""
    out = []
    for chunk in sorted(chunks, key=lambda c: c["chunk_index"]):
        spans = ((chunk.get("anchors") or {}).get("spans")) or []
        total = sum(max(0, s["char_end"] - s["char_start"]) for s in spans)
        if not total:
            continue
        done, lo, hi = 0, None, None
        for span in spans:
            size = max(0, span["char_end"] - span["char_start"])
            if first_page <= span["page"] <= last_page and size:
                lo = done / total if lo is None else lo
                hi = (done + size) / total
            done += size
        if lo is not None:
            out.append(Slice(chunk_index=chunk["chunk_index"], lo=lo, hi=hi,
                             words=prose_words(_chunk_text(chunk)) * (hi - lo)))
    return out


def epub_slices(chunks: list[dict], start_cfi: str, end_cfi: str) -> list[Slice]:
    """The blocks from the start's block to the bookmark's, by chunks.block_paths (A6)."""
    ordered = sorted(chunks, key=lambda c: c["chunk_index"])
    paths = [c.get("block_paths") or [] for c in ordered]
    start, end = block_for_cfi(start_cfi, paths), block_for_cfi(end_cfi, paths)
    if start is None or end is None:
        return []
    out = []
    for position, chunk in enumerate(ordered):
        blocks = chunk.get("blocks") or []
        if not blocks or not start[0] <= position <= end[0]:
            continue
        ids = [b["id"] for b in blocks]
        first = ids.index(start[1]) if position == start[0] and start[1] in ids else 0
        last = ids.index(end[1]) if position == end[0] and end[1] in ids else len(ids) - 1
        lengths = [len(b.get("text") or "") for b in blocks]
        total = sum(lengths) + len(BLOCK_JOIN) * (len(blocks) - 1) or 1
        offsets = [sum(lengths[:i]) + len(BLOCK_JOIN) * i for i in range(len(blocks))]
        if first > last:
            continue
        out.append(Slice(chunk_index=chunk["chunk_index"], lo=offsets[first] / total,
                         hi=(offsets[last] + lengths[last]) / total,
                         words=sum(prose_words(b.get("text")) for b in blocks[first:last + 1])))
    return out


def toc_slices(chunks: list[dict], toc: list[dict], kind: str, first_unit: int, last_unit: int) -> list[Slice]:
    """Whole chunks, from the chapter holding the start to the end of the chapter holding the bookmark."""
    key = "page" if kind == "pdf" else "spine_index"
    entries = sorted((e for e in toc or [] if e.get(key) is not None and e.get("chunk_index") is not None),
                     key=lambda e: e[key])
    if not entries:
        return []
    holding = [i for i, e in enumerate(entries) if e[key] <= first_unit]
    begin = entries[holding[-1]]["chunk_index"] if holding else entries[0]["chunk_index"]
    upto = [i for i, e in enumerate(entries) if e[key] <= last_unit]
    after = upto[-1] + 1 if upto else 0
    stop = entries[after]["chunk_index"] - 1 if after < len(entries) else max(c["chunk_index"] for c in chunks)
    return [Slice(chunk_index=c["chunk_index"], lo=0, hi=1, words=prose_words(_chunk_text(c)))
            for c in sorted(chunks, key=lambda c: c["chunk_index"]) if begin <= c["chunk_index"] <= max(begin, stop)]


def spread(items: list, k: int) -> list:
    """At most k of the items, evenly spaced from the first to the last, in order (C36.G)."""
    if k <= 0:
        return []
    if len(items) <= k:
        return list(items)
    if k == 1:
        return [items[0]]
    return [items[round(i * (len(items) - 1) / (k - 1))] for i in range(k)]


def evidence_fraction(text: str, evidence: str | None) -> float | None:
    """Where a question's evidence starts in its chunk's text, as a fraction of it; None when not found."""
    if not text or not evidence:
        return None
    at = text.find(evidence.split(" … ")[0].strip())
    return at / len(text) if at >= 0 else None


def position_in_range(slices: list[Slice], chunk_index: int, fraction: float | None) -> float | None:
    """A question's place in the range's words, or None when it lies outside the range."""
    before = 0.0
    for s in slices:
        if s.chunk_index == chunk_index:
            f = (s.lo + s.hi) / 2 if fraction is None else fraction
            if not s.lo - 1e-9 <= f <= s.hi + 1e-9:
                return None
            return before + (f - s.lo) / max(s.hi - s.lo, 1e-9) * s.words
        before += s.words
    return None


class Candidate(BaseModel):
    position: float
    question: BankQuestion


def scaled_mix(mix: list, n: int) -> list[tuple[list[str], int]]:
    """The mix's places scaled to n questions, largest remainders first."""
    total = sum(count for _s, count in mix)
    if not total:
        return []
    exact = [count * n / total for _s, count in mix]
    places = [floor(x) for x in exact]
    for i in sorted(range(len(mix)), key=lambda i: places[i] - exact[i])[:n - sum(places)]:
        places[i] += 1
    return [(list(strategies), p) for (strategies, _c), p in zip(mix, places)]


def select(candidates: list[Candidate], n: int, words: float, mix: list | None = None,
           target_difficulty: float = policy.TEST_TARGET_DIFFICULTY) -> list[Candidate]:
    """n questions spread over n equal strata of the range: each pass takes one from every stratum that has
    had fewest, so the strata fill evenly; in a stratum, a question that fills a place of the mix first, then
    the least used, nearest the target difficulty, of better quality."""
    width = max(words, 1e-9) / n
    quota = [[set(strategies), places] for strategies, places in scaled_mix(mix or policy.TEST_MIX, n)]
    strata: dict[int, list[Candidate]] = {}
    for c in candidates:
        strata.setdefault(min(int(c.position // width), n - 1), []).append(c)
    picked: list[Candidate] = []
    taken = dict.fromkeys(strata, 0)
    asked: set[str] = set()

    def place(c):
        return next((q for q in quota if c.question.strategy in q[0] and q[1] > 0), None)

    def rank(c):
        diff = target_difficulty if c.question.difficulty is None else c.question.difficulty
        return (place(c) is None, c.question.times_used or 0, round(abs(diff - target_difficulty), 6),
                -(c.question.quality or 0.0), c.question.id)

    def usable(c):
        return c.question.evidence not in asked and (c.question.answer or c.question.id).strip().lower() not in asked

    while len(picked) < n:
        open_strata = [s for s in sorted(strata) if any(usable(c) for c in strata[s])]
        if not open_strata:
            break
        fewest = min(taken[s] for s in open_strata)
        for s in [s for s in open_strata if taken[s] == fewest]:
            pool = [c for c in strata[s] if usable(c)]
            if not pool or len(picked) >= n:
                continue
            best = min(pool, key=rank)
            hit = place(best)
            if hit:
                hit[1] -= 1
            picked.append(best)
            taken[s] += 1
            asked.update({best.question.evidence, (best.question.answer or best.question.id).strip().lower()})
    return sorted(picked, key=lambda c: c.position)


def weighted_correct(grades: list[dict]) -> tuple[float, int]:
    """(correct answers, a low-confidence one counting half; how many were correct at all). Correct is a score of
    at least QUIZ_CORRECT_FROM of the question's maximum."""
    weighted, whole = 0.0, 0
    for g in grades:
        if g.get("max_score") and g["score"] / g["max_score"] >= policy.QUIZ_CORRECT_FROM:
            whole += 1
            weighted += policy.QUIZ_LOW_CONFIDENCE_WEIGHT if g.get("confidence") == "low" else 1.0
    return weighted, whole
