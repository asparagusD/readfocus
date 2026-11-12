"""The reading strategy planner: pure decide() on hand-made chunks and concepts. No database, no model."""

import inspect
from datetime import datetime, timedelta

import pytest

from backend.agents import policy
from backend.agents.planner import strategy as strategy_module
from backend.agents.planner.strategy import (
    ChunkInfo,
    ConceptState,
    PaceHint,
    PlannerInput,
    decide,
)

NOW = datetime(2026, 11, 11, 9, 0)


def chunks(*words, keys=None):
    keys = keys or {}
    return [ChunkInfo(index=i, word_count=w, concept_keys=keys.get(i, [])) for i, w in enumerate(words)]


def concept(key, mastery, attempts=0, correct=0, label="", due_in_days=None):
    review = None if due_in_days is None else NOW + timedelta(days=due_in_days)
    return ConceptState(
        concept_key=key, label=label, mastery=mastery, attempts=attempts, correct=correct, next_review=review
    )


def plan(**fields):
    return decide(PlannerInput(now=NOW, **fields))


# --- the four cases the C8.1 prompt names ----------------------------------------------


def test_cold_start_reads_the_first_section_at_the_default_pace():
    result = plan(chunks=chunks(300, 300, 300, 300))
    assert result.mode == "new" and result.rule == "next_unread"
    assert result.chunk_indices == [0, 1]  # 600 words at the default target
    assert result.assigned_words == 600
    assert result.focus_duration_minutes == 10  # 600 / 200 wpm = 3 min, raised to the minimum
    assert result.question_mix == policy.PLANNER_QUESTION_MIX["new"]
    assert result.reason == "Starting the book with sections 1–2, about 600 words."


def test_everything_read_and_nothing_weak_means_the_book_is_finished():
    result = plan(last_chunk_index=3, chunks=chunks(300, 300, 300, 300, keys={1: ["rent"]}),
                  concepts=[concept("rent", 0.8, attempts=3, correct=3, due_in_days=5)])
    assert result.mode == "finished" and result.rule == "finished"
    assert result.chunk_indices == [] and result.assigned_words == 0 and result.question_mix == []
    assert result.reason == "You have read every section and nothing is due for review."


def test_everything_read_with_a_weak_concept_reviews_its_section():
    result = plan(last_chunk_index=3, chunks=chunks(300, 300, 300, 300, keys={2: ["rent"]}),
                  concepts=[concept("rent", 0.2, attempts=2, correct=0)])
    assert result.mode == "review" and result.chunk_indices == [2]


def test_a_weak_concept_brings_its_section_back_with_a_reason():
    result = plan(
        last_chunk_index=2,
        chunks=chunks(400, 400, 400, 400, 400, keys={0: ["scarcity"], 1: ["opportunity-cost"], 3: ["supply"]}),
        concepts=[concept("opportunity-cost", 0.2, attempts=2, correct=0, label="opportunity cost"),
                  concept("scarcity", 0.7, attempts=2, correct=2, due_in_days=4)],
    )
    assert result.mode == "review" and result.rule == "weak_concepts"
    assert result.chunk_indices == [1]
    assert result.reason == "Revisiting *opportunity cost* — you missed it twice."
    assert result.question_mix == policy.PLANNER_QUESTION_MIX["review"]
    assert result.scores[0].index == 1 and result.scores[1].index == 3  # the next unread section comes second


def test_the_re_read_queue_comes_before_everything_else():
    result = plan(
        last_chunk_index=3, re_read_queue=[2, 0],
        chunks=chunks(300, 300, 300, 300, 300, keys={1: ["rent"]}),
        concepts=[concept("rent", 0.1, attempts=4, correct=0)],
    )
    assert result.mode == "re_read" and result.rule == "re_read_queue"
    assert result.chunk_indices == [2] and result.assigned_words == 300
    assert result.reason == "Re-reading section 3 before moving on — your last test on it was low."
    assert result.question_mix == policy.PLANNER_QUESTION_MIX["re_read"]


# --- scoring ---------------------------------------------------------------------------


def test_weights_sum_to_one_and_name_the_four_components():
    assert set(policy.PLANNER_WEIGHTS) == {"weak_concept_coverage", "unread", "difficulty_fit", "due_for_review"}
    assert sum(policy.PLANNER_WEIGHTS.values()) == pytest.approx(1.0)


def test_each_score_is_the_weighted_sum_of_its_components():
    result = plan(last_chunk_index=0, chunks=chunks(300, 300, keys={0: ["a", "b"]}),
                  concepts=[concept("a", 0.1, attempts=1), concept("b", 0.9, attempts=1, correct=1, due_in_days=-1)])
    for scored in result.scores:
        expected = sum(policy.PLANNER_WEIGHTS[name] * value for name, value in scored.components.items())
        assert scored.score == pytest.approx(expected)
    read = next(s for s in result.scores if s.index == 0)
    assert read.components["weak_concept_coverage"] == 0.5 and read.components["due_for_review"] == 0.5
    assert read.components["unread"] == 0.0


def test_an_untested_concept_is_not_weak_even_at_the_prior():
    result = plan(last_chunk_index=0, chunks=chunks(300, 300, keys={0: ["a"]}), concepts=[concept("a", 0.3)])
    assert result.mode == "new" and result.chunk_indices == [1]


def test_weak_boundary_is_strictly_below():
    for mastery, weak in ((policy.PLANNER_WEAK_BELOW - 0.01, True), (policy.PLANNER_WEAK_BELOW, False)):
        result = plan(last_chunk_index=1, chunks=chunks(300, 300, keys={0: ["a"]}),
                      concepts=[concept("a", mastery, attempts=1)])
        assert (result.mode == "review") is weak


def test_a_concept_due_for_review_has_its_own_reason():
    result = plan(last_chunk_index=1, chunks=chunks(300, 300, keys={0: ["tides"]}),
                  concepts=[concept("tides", 0.7, attempts=2, correct=2, due_in_days=0)])
    assert result.rule == "due_for_review" and result.chunk_indices == [0]
    assert result.reason == "Revisiting *tides* — it is due for review."


def test_difficulty_fit_follows_recent_scores():
    hard, easy = ChunkInfo(index=0, word_count=300, difficulty=0.6), ChunkInfo(index=0, word_count=300, difficulty=0.3)
    def fit(chunk, recent):
        return plan(chunks=[chunk], recent_percentages=recent).scores[0].components["difficulty_fit"]
    assert fit(hard, [90, 85]) == 1.0 and fit(easy, [90, 85]) < 1.0
    assert fit(easy, [30, 40]) == 1.0 and fit(hard, [30, 40]) < 1.0
    assert fit(ChunkInfo(index=0, word_count=300), []) == policy.PLANNER_UNKNOWN_DIFFICULTY_FIT


def test_ties_go_to_the_earlier_section():
    result = plan(last_chunk_index=2, chunks=chunks(300, 300, 300, keys={0: ["a"], 2: ["a"]}),
                  concepts=[concept("a", 0.1, attempts=1)])
    assert result.chunk_indices == [0]


# --- pace and size ---------------------------------------------------------------------


def test_the_optimizer_multiplier_grows_and_shrinks_the_session():
    book = chunks(300, 300, 300, 300)
    assert plan(chunks=book, pace=PaceHint(next_chunk_multiplier=1.5)).chunk_indices == [0, 1, 2]
    assert plan(chunks=book, pace=PaceHint(next_chunk_multiplier=0.5)).chunk_indices == [0]


def test_the_recommended_focus_time_caps_the_words():
    result = plan(chunks=chunks(300, 300, 300), wpm=100, pace=PaceHint(focus_duration_minutes=4))
    assert result.chunk_indices == [0]  # 4 min at 100 wpm is 400 words


def test_a_section_longer_than_the_target_is_still_read_alone():
    result = plan(chunks=chunks(2000, 300))
    assert result.chunk_indices == [0] and result.assigned_words == 2000


def test_never_more_than_the_maximum_number_of_sections():
    result = plan(chunks=chunks(*[50] * 10))
    assert len(result.chunk_indices) == policy.PLANNER_MAX_CHUNKS


def test_a_gap_in_the_candidates_ends_the_session():
    book = [ChunkInfo(index=0, word_count=200), ChunkInfo(index=2, word_count=200)]
    assert plan(chunks=book).chunk_indices == [0]


def test_duration_clamps_and_buffer():
    low, high = policy.PLANNER_MINUTES_RANGE
    assert plan(chunks=chunks(100)).focus_duration_minutes == low
    assert plan(chunks=chunks(50000), wpm=100).focus_duration_minutes == high
    plain = plan(chunks=chunks(3000), wpm=100).focus_duration_minutes
    buffered = plan(chunks=chunks(3000), wpm=100, recent_percentages=[20]).focus_duration_minutes
    assert plain == 30 and buffered == 33


def test_a_missing_or_zero_wpm_uses_the_default():
    assert plan(chunks=chunks(3000), wpm=0).focus_duration_minutes == 3000 // policy.PLANNER_DEFAULT_WPM
    assert plan(chunks=chunks(3000)).focus_duration_minutes == 3000 // policy.PLANNER_DEFAULT_WPM


def test_every_question_mix_fills_one_test():
    for mix in policy.PLANNER_QUESTION_MIX.values():
        assert sum(places for _, places in mix) == policy.TEST_QUESTION_COUNT


def test_continuing_reasons_mention_the_pace():
    book = chunks(300, 300, 300, 300, 300)
    assert plan(last_chunk_index=0, chunks=book).reason == "Continuing with sections 2–3, about 600 words."
    assert plan(last_chunk_index=0, chunks=book, pace=PaceHint(next_chunk_multiplier=0.5)).reason == (
        "Continuing with section 2, about 300 words — a lighter session after your last test."
    )
    assert plan(last_chunk_index=0, chunks=book, pace=PaceHint(next_chunk_multiplier=1.5)).reason.endswith(
        "— a little more, since you are scoring well."
    )


def test_a_queue_entry_that_is_not_a_candidate_is_skipped():
    result = plan(re_read_queue=[9], chunks=chunks(300))
    assert result.mode == "new" and result.chunk_indices == [0]


# --- purity ----------------------------------------------------------------------------


def test_same_input_same_output_and_input_untouched():
    data = PlannerInput(now=NOW, last_chunk_index=0, re_read_queue=[0], chunks=chunks(300, 300))
    before = data.model_dump()
    assert decide(data) == decide(data)
    assert data.model_dump() == before


def test_the_module_does_no_io():
    source = inspect.getsource(strategy_module)
    for banned in ("supabase", "embedder", "llm", "langchain", "random", "datetime.now", "time.time", "open("):
        assert banned not in source
