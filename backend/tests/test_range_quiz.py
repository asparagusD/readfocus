"""The bookmark-range quiz, pure parts (C23.5, FOCUS_RULES F10-F12): the question count, the range's prose words
from chunk anchors (PDF pages, EPUB blocks, the contents as a fallback), where a question sits in the range, and a
selection stratified across it."""

import pytest

from backend.agents.question_generation.assembler import BankQuestion
from backend.focus import range_quiz as rq

WORDS = " ".join(["word"] * 100)  # 100 words


@pytest.mark.parametrize("words, n", [(0, 3), (400, 3), (1199, 3), (1400, 4), (2000, 5), (2199, 5), (2200, 6),
                                      (6000, 15), (40_000, 15)])
def test_the_question_count_is_words_over_400_rounded_and_clamped(words, n):
    assert rq.question_count(words) == n


def test_prose_words_leave_placeholders_out():
    assert rq.prose_words("Ohm's law [Equation 3.2, p. 45] holds. [Figure 3.4: A circuit, p. 47]") == 3


# --- the range's slices -------------------------------------------------------------------------------------------

def pdf_chunk(index, spans, words=300):
    return {"chunk_index": index, "prose": " ".join(["word"] * words), "content": "",
            "anchors": {"kind": "pdf", "pages": [spans[0][0], spans[-1][0]],
                        "spans": [{"page": p, "char_start": 0, "char_end": n} for p, n in spans]}}


def test_pdf_slices_take_the_pages_from_start_to_bookmark_in_proportion():
    chunks = [pdf_chunk(0, [(1, 1000), (2, 1000), (3, 1000)]), pdf_chunk(1, [(3, 500), (4, 1500)], words=400),
              pdf_chunk(2, [(5, 1000)])]
    slices = rq.pdf_slices(chunks, 2, 4)
    assert [(s.chunk_index, round(s.lo, 3), round(s.hi, 3), round(s.words)) for s in slices] == [
        (0, 0.333, 1.0, 200), (1, 0.0, 1.0, 400)]


def test_epub_slices_run_from_the_start_block_to_the_bookmark_block():
    blocks = [[{"id": "0.0", "text": WORDS}, {"id": "0.1", "text": WORDS + " [Equation 1, sec. 2]"}],
              [{"id": "1.0", "text": WORDS}, {"id": "1.1", "text": WORDS}]]
    paths = [[{"block_id": "0.0", "spine_index": 2, "path": "/4/2"}, {"block_id": "0.1", "spine_index": 2, "path": "/4/4"}],
             [{"block_id": "1.0", "spine_index": 3, "path": "/4/2"}, {"block_id": "1.1", "spine_index": 3, "path": "/4/4"}]]
    chunks = [{"chunk_index": i, "blocks": b, "block_paths": p} for i, (b, p) in enumerate(zip(blocks, paths))]
    slices = rq.epub_slices(chunks, "epubcfi(/6/6!/4/4/1:3)", "epubcfi(/6/8!/4/2/1:9)")
    # Fractions are of the chunk's characters (as evidence offsets are); words leave the placeholder out.
    assert [(s.chunk_index, round(s.lo, 1), round(s.hi, 1), s.words) for s in slices] == [(0, 0.5, 1.0, 100), (1, 0.0, 0.5, 100)]


def test_without_anchors_the_contents_give_whole_chunks():
    toc = [{"title": "One", "spine_index": 1, "chunk_index": 0}, {"title": "Two", "spine_index": 4, "chunk_index": 2},
           {"title": "Three", "spine_index": 7, "chunk_index": 5}]
    chunks = [{"chunk_index": i, "prose": WORDS, "content": WORDS} for i in range(7)]
    slices = rq.toc_slices(chunks, toc, "epub", 4, 6)
    assert [(s.chunk_index, s.lo, s.hi, s.words) for s in slices] == [(2, 0, 1, 100), (3, 0, 1, 100), (4, 0, 1, 100)]


def test_a_question_sits_where_its_evidence_is_and_outside_the_range_it_does_not():
    slices = [rq.Slice(chunk_index=0, lo=0.5, hi=1.0, words=100), rq.Slice(chunk_index=1, lo=0.0, hi=0.5, words=100)]
    assert rq.position_in_range(slices, 0, 0.75) == pytest.approx(50)
    assert rq.position_in_range(slices, 1, 0.25) == pytest.approx(150)
    assert rq.position_in_range(slices, 0, 0.2) is None and rq.position_in_range(slices, 1, 0.9) is None
    assert rq.position_in_range(slices, 7, 0.5) is None
    assert rq.position_in_range(slices, 1, None) == pytest.approx(150)  # evidence not found: the slice's middle
    assert rq.evidence_fraction("Alpha beta. Gamma delta. Epsilon.", "Gamma delta.") == pytest.approx(12 / 33)
    assert rq.evidence_fraction("Alpha beta.", "Not here.") is None


# --- selection ----------------------------------------------------------------------------------------------------

def q(n, position, strategy="cloze", used=0, difficulty=0.4, quality=0.8, evidence=None):
    return rq.Candidate(position=position, question=BankQuestion(
        id=f"q{n}", chunk_index=0, type="factual", strategy=strategy, prompt=f"P{n}?", answer=f"a{n}",
        evidence=evidence or f"e{n}", difficulty=difficulty, quality=quality, times_used=used))


def test_one_question_per_stratum_even_when_most_sit_at_the_start():
    pool = [q(i, i) for i in range(20)] + [q(100 + s, s * 200 + 10) for s in range(1, 5)]
    picked = rq.select(pool, n=5, words=1000)
    assert [int(c.position // 200) for c in picked] == [0, 1, 2, 3, 4]


def test_empty_strata_are_filled_from_the_fullest_and_the_result_is_in_reading_order():
    pool = [q(i, 10 + i) for i in range(6)] + [q(50, 900)]
    picked = rq.select(pool, n=4, words=1000)
    assert len(picked) == 4 and [c.position for c in picked] == sorted(c.position for c in picked)
    assert 900 in [c.position for c in picked]


def test_within_a_stratum_unused_then_difficulty_then_quality():
    pool = [q(1, 10, used=2), q(2, 20, difficulty=0.9), q(3, 30, difficulty=0.45, quality=0.5), q(4, 40, quality=0.9)]
    assert rq.select(pool, n=1, words=100, target_difficulty=0.4)[0].question.id == "q4"
    assert rq.select(pool[:3], n=1, words=100, target_difficulty=0.4)[0].question.id == "q3"


def test_the_mix_is_scaled_to_the_count_and_honoured_across_strata():
    mix = [(["multiple_choice"], 2), (["cloze"], 1), (["definition", "why_how"], 1), (["main_idea"], 1)]
    assert rq.scaled_mix(mix, 10) == [(["multiple_choice"], 4), (["cloze"], 2), (["definition", "why_how"], 2),
                                      (["main_idea"], 2)]
    assert sum(c for _s, c in rq.scaled_mix(mix, 3)) == 3
    pool = [q(s * 10 + i, s * 100 + 1 + i, strategy=strategy) for s in range(4) for i, strategy in enumerate(
        ["cloze", "multiple_choice", "why_how", "main_idea", "cloze"])]
    picked = rq.select(pool, n=4, words=400, mix=[(["multiple_choice"], 2), (["cloze"], 1), (["main_idea"], 1)])
    assert sorted(c.question.strategy for c in picked) == ["cloze", "main_idea", "multiple_choice", "multiple_choice"]


def test_one_sentence_or_answer_is_never_asked_twice():
    pool = [q(1, 10, evidence="same"), q(2, 20, evidence="same"), q(3, 30)]
    assert {c.question.id for c in rq.select(pool, n=3, words=100)} == {"q1", "q3"}


# --- grading: low confidence counts half --------------------------------------------------------------------------

def test_correct_answers_are_weighted_by_confidence():
    grades = [{"score": 10, "max_score": 10, "confidence": "high"}, {"score": 7, "max_score": 10, "confidence": "medium"},
              {"score": 9, "max_score": 10, "confidence": "low"}, {"score": 6, "max_score": 10, "confidence": "high"},
              {"score": 0, "max_score": 10, "confidence": "low"}]
    assert rq.weighted_correct(grades) == (2.5, 3)


@pytest.mark.parametrize("items, k, expected", [
    ([1, 2, 3], 4, [1, 2, 3]), (list(range(10)), 4, [0, 3, 6, 9]), (list(range(10)), 1, [0]), ([1, 2], 0, []),
    (list(range(5)), 2, [0, 4]),
])
def test_spread_picks_at_most_k_evenly_from_first_to_last(items, k, expected):
    assert rq.spread(items, k) == expected
