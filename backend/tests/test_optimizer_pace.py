"""The learning optimizer: pure decide() on hand-made scores, sessions and question outcomes. No database."""

import inspect

import pytest

from backend.agents import policy
from backend.agents.optimizer import pace as pace_module
from backend.agents.optimizer.pace import OptimizerInput, QuestionOutcome, decide


def run(percentage, **fields):
    fields.setdefault("chunk_indices", [4])
    return decide(OptimizerInput(percentage=percentage, **fields))


def outcomes(strategy, *scores):
    return [QuestionOutcome(strategy=strategy, score=score) for score in scores]


# --- score bands (the old optimizer's 40 / 25 / 10 of 50 points, as percentages) -----


@pytest.mark.parametrize("percentage, band, multiplier", [
    (100, "grow", 1.15), (80, "grow", 1.15), (79.9, "hold", 1.0), (50, "hold", 1.0),
    (49.9, "reduce", 0.80), (20, "reduce", 0.80), (19.9, "fail", 0.50), (0, "fail", 0.50),
])
def test_each_band_at_its_boundaries(percentage, band, multiplier):
    result = run(percentage)
    assert result.band == band
    assert result.next_chunk_multiplier == pytest.approx(multiplier)


def test_reduce_appends_the_sections_to_the_re_read_queue():
    result = run(30, chunk_indices=[4, 5], re_read_queue=[1, 5])
    assert result.re_read_queue == [1, 5, 4] and result.re_read_mode is False


def test_fail_puts_the_sections_first_and_switches_to_re_read_mode():
    result = run(10, chunk_indices=[4, 5], re_read_queue=[1, 5])
    assert result.re_read_queue == [4, 5, 1] and result.re_read_mode is True


def test_a_passed_section_leaves_the_queue():
    assert run(60, chunk_indices=[4], re_read_queue=[1, 4]).re_read_queue == [1]


def test_the_queue_is_bounded():
    result = run(10, chunk_indices=[9], re_read_queue=list(range(policy.OPT_REREAD_QUEUE_MAX)))
    assert len(result.re_read_queue) == policy.OPT_REREAD_QUEUE_MAX and result.re_read_queue[0] == 9


# --- rolling scores and bounds -----------------------------------------------------------


def test_rolling_scores_damp_one_good_test():
    result = run(90, recent_percentages=[40, 40, 100])  # only the last three tests count
    assert result.rolling_percentage == pytest.approx(170 / 3)
    assert result.next_chunk_multiplier == 1.0


def test_one_bad_test_after_good_ones_never_grows():
    result = run(40, recent_percentages=[100, 100])  # rolling 80 would grow
    assert result.next_chunk_multiplier == 1.0 and result.re_read_queue == [4]
    assert "no_growth_after_low_test" in result.rules


def test_the_multiplier_compounds_within_its_bounds():
    low, high = policy.PLANNER_MULTIPLIER_RANGE
    assert run(95, previous_multiplier=1.5).next_chunk_multiplier == pytest.approx(1.725)
    assert run(95, previous_multiplier=1.9).next_chunk_multiplier == high
    assert run(5, previous_multiplier=0.6).next_chunk_multiplier == low
    many = 1.0
    for _ in range(30):
        many = run(95, previous_multiplier=many).next_chunk_multiplier
    assert many == high


# --- abandonment -------------------------------------------------------------------------


def test_recent_abandonment_shortens_sessions_instead_of_growing():
    limit = policy.OPT_ABANDON_LIMIT
    stopped = run(95, recent_abandoned=[True] * limit)
    assert stopped.next_chunk_multiplier == pytest.approx(policy.OPT_ABANDON_FACTOR)
    assert "abandonment" in stopped.rules and "You stopped early recently" in stopped.reason
    assert run(95, recent_abandoned=[True] * (limit - 1)).next_chunk_multiplier == pytest.approx(1.15)


def test_only_the_abandonment_window_counts():
    old = [False] * policy.OPT_ABANDON_WINDOW + [True] * 5
    assert run(95, recent_abandoned=old).next_chunk_multiplier == pytest.approx(1.15)


# --- focus minutes -----------------------------------------------------------------------


def test_focus_minutes_from_the_next_word_target_and_reading_speed():
    result = run(60, wpm=50)  # 600 words at 50 wpm
    assert result.focus_duration_minutes == 12 and result.reading_wpm == 50


def test_observed_speed_is_used_within_bounds():
    low, high = policy.OPT_SPEED_RANGE
    assert run(60, wpm=100, session_words=900, actual_minutes=10).reading_wpm == 90
    assert run(60, wpm=100, session_words=5000, actual_minutes=10).reading_wpm == 100 * high
    assert run(60, wpm=100, session_words=100, actual_minutes=10).reading_wpm == 100 * low
    assert run(60, wpm=100, session_words=900, actual_minutes=0).reading_wpm == 100


def test_focus_minutes_are_clamped():
    low, high = policy.PLANNER_MINUTES_RANGE
    assert run(60, wpm=1000).focus_duration_minutes == low
    assert run(95, previous_multiplier=2.0, wpm=5).focus_duration_minutes == high


# --- question mix by per-type failure -----------------------------------------------------


def places(mix):
    return {tuple(strategies): count for strategies, count in mix}


def test_a_failing_type_gets_one_more_place_from_the_strongest():
    result = run(60, outcomes=outcomes("cloze", 0.0, 0.2) + outcomes("multiple_choice", 1.0, 1.0))
    mix = places(result.question_mix)
    assert mix[("cloze",)] == 2 and mix[("multiple_choice",)] == 1
    assert sum(mix.values()) == policy.TEST_QUESTION_COUNT
    assert "One more fill-in-the-blank question next time." in result.reason


def test_a_type_in_a_shared_group_counts_for_its_group():
    result = run(60, outcomes=outcomes("why_how", 0.1, 0.3))
    assert places(result.question_mix)[("definition", "why_how")] == 2


def test_too_few_samples_change_nothing():
    result = run(60, outcomes=outcomes("cloze", 0.0))
    assert result.question_mix == policy.TEST_MIX and "question_mix" not in result.rules


def test_failure_boundary_is_strictly_below():
    at = run(60, outcomes=outcomes("cloze", policy.OPT_TYPE_FAIL_BELOW, policy.OPT_TYPE_FAIL_BELOW))
    assert at.question_mix == policy.TEST_MIX


def test_one_place_moves_per_test_and_the_bounds_hold():
    low, high = policy.OPT_MIX_PLACES_RANGE
    mix = policy.TEST_MIX
    failing = outcomes("cloze", 0.0, 0.0) + outcomes("main_idea", 0.0, 0.0)
    for _ in range(6):
        new = run(60, outcomes=failing, previous_mix=mix).question_mix
        moved = sum(abs(a[1] - b[1]) for a, b in zip(new, mix))
        assert moved in (0, 2)  # one place taken and one given, or nothing
        assert all(low <= count <= high for _, count in new)
        assert sum(count for _, count in new) == policy.TEST_QUESTION_COUNT
        mix = new
    assert places(mix)[("multiple_choice",)] == low  # the donor never drops below the minimum


def test_no_donor_leaves_the_mix_unchanged():
    flat = [(["cloze"], 1), (["multiple_choice"], 1), (["definition"], 1), (["why_how"], 1), (["main_idea"], 1)]
    assert run(60, outcomes=outcomes("cloze", 0.0, 0.0), previous_mix=flat).question_mix == flat


def test_a_failing_type_is_not_a_donor():
    mix = [(["cloze"], 1), (["multiple_choice"], 3), (["main_idea"], 1)]
    result = run(60, previous_mix=mix, outcomes=outcomes("cloze", 0.0, 0.1) + outcomes("multiple_choice", 0.2, 0.2))
    assert result.question_mix == mix  # multiple choice is failing too, and main idea is at its minimum


def test_the_donor_is_the_group_with_most_places():
    mix = [(["cloze"], 1), (["multiple_choice"], 2), (["main_idea"], 2)]
    result = run(60, previous_mix=mix, outcomes=outcomes("cloze", 0, 0) + outcomes("main_idea", 1, 1))
    assert places(result.question_mix) == {("cloze",): 2, ("multiple_choice",): 2, ("main_idea",): 1}


def test_unknown_strategies_are_ignored():
    assert run(60, outcomes=outcomes(None, 0.0, 0.0) + outcomes("riddle", 0, 0)).question_mix == policy.TEST_MIX


# --- output and purity ---------------------------------------------------------------------


def test_the_output_has_the_keys_the_results_page_reads():
    data = run(85).model_dump()
    for key in ("next_chunk_multiplier", "focus_duration_minutes", "re_read_mode", "reason"):
        assert key in data


def test_reasons_are_encouraging_and_specific():
    assert run(85).reason == "Strong result — the next session is a little longer."
    assert run(60).reason == "Solid result — the next session stays the same length."
    assert run(30).reason == "Some of this did not stick — the next session is a little shorter, and this section is on your re-read list."
    assert run(5).reason == "This one was hard — the next session is a little shorter, and you will re-read this section first."


def test_same_input_same_output_and_input_untouched():
    data = OptimizerInput(percentage=10, chunk_indices=[3], re_read_queue=[1], outcomes=outcomes("cloze", 0, 0))
    before = data.model_dump()
    assert decide(data) == decide(data)
    assert data.model_dump() == before


def test_the_module_does_no_io():
    source = inspect.getsource(pace_module)
    for banned in ("supabase", "embedder", "llm", "langchain", "random", "datetime", "time.time", "open("):
        assert banned not in source


# --- no test: an abandoned session (C8.5) --------------------------------------------------------


def test_no_test_leaves_the_queue_and_holds_without_history():
    result = run(None, chunk_indices=[4], re_read_queue=[4, 1])
    assert result.band == "none" and result.re_read_queue == [4, 1] and result.re_read_mode is False
    assert result.rolling_percentage is None and result.next_chunk_multiplier == 1.0
    assert result.reason == "No test this time — the next session stays the same length."


def test_a_run_with_no_test_holds_the_multiplier():
    # The earlier tests moved the multiplier when they were submitted; a run without a test must not
    # apply them again (issue 31).
    for recent in ([10], [90, 85], [30, 60, 95]):
        result = run(None, recent_percentages=recent, previous_multiplier=1.3)
        assert result.next_chunk_multiplier == pytest.approx(1.3) and "no_test_hold" in result.rules


def test_no_test_follows_abandonment_only():
    stopped = run(None, recent_percentages=[90], recent_abandoned=[True] * policy.OPT_ABANDON_LIMIT)
    assert stopped.next_chunk_multiplier == pytest.approx(policy.OPT_ABANDON_FACTOR)
