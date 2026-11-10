"""Test assembly from bank rows: pure, so no database, model or network."""

from backend.agents import policy
from backend.agents.question_generation import assembler
from backend.agents.question_generation.assembler import AssemblyInput, BankQuestion

DIFFICULTY = {"multiple_choice": 0.2, "cloze": 0.3, "definition": 0.4, "why_how": 0.6, "main_idea": 0.7}


def row(id, strategy, chunk_index=0, quality=0.8, times_used=0, evidence=None, **extra) -> BankQuestion:
    fields = {
        "id": id, "chunk_index": chunk_index, "strategy": strategy, "quality": quality, "times_used": times_used,
        "type": {"why_how": "inference", "main_idea": "summary"}.get(strategy, "factual"),
        "prompt": f"prompt {id}", "answer": f"answer {id}", "evidence": evidence or f"evidence {id}",
        "key_terms": [f"term {id}"], "difficulty": DIFFICULTY[strategy],
        "distractors": ["wrong 1", "wrong 2", "wrong 3"] if strategy == "multiple_choice" else [],
    }
    return BankQuestion(**{**fields, **extra})


def bank():
    return [
        row("m1", "multiple_choice"), row("m2", "multiple_choice"), row("m3", "multiple_choice"),
        row("c1", "cloze"), row("c2", "cloze"), row("c3", "cloze"),
        row("d1", "definition"), row("w1", "why_how"), row("i1", "main_idea"),
    ]


def picked(questions, **changes):
    return [q.id for q in assembler.decide(AssemblyInput(questions=questions, **changes)).questions]


def test_default_mix_is_two_choice_one_cloze_one_definition_or_why_one_main_idea():
    result = assembler.decide(AssemblyInput(questions=bank()))
    assert [q.strategy for q in result.questions] == [
        "multiple_choice", "multiple_choice", "cloze", "definition", "main_idea",
    ]
    assert len(result.questions) == policy.TEST_QUESTION_COUNT == 5
    assert result.missing == {}


def test_unused_questions_come_first_then_the_better_ones():
    questions = [
        row("old", "cloze", quality=0.95, times_used=1), row("new", "cloze", quality=0.70),
        row("best", "cloze", quality=0.90),
    ]
    assert picked(questions) == ["best", "new", "old"]
    assert picked(questions, count=1) == ["best"]
    used_twice = [row("a", "cloze", times_used=2), row("b", "cloze", times_used=1)]
    assert picked(used_twice, count=1) == ["b"]


def test_an_empty_slot_is_filled_by_the_closest_difficulty():
    questions = [
        row("c1", "cloze"), row("c2", "cloze"), row("c3", "cloze"), row("c4", "cloze"),
        row("w1", "why_how"), row("w2", "why_how"), row("i1", "main_idea"),
    ]
    result = assembler.decide(AssemblyInput(questions=questions, target_difficulty=0.6))
    # No multiple choice: its two places go to the questions nearest 0.6, the second why/how first.
    assert [q.id for q in result.questions] == ["c1", "w1", "w2", "c2", "i1"]
    assert result.missing == {"multiple_choice": 2}
    easy = assembler.decide(AssemblyInput(questions=questions, target_difficulty=0.3))
    assert [q.id for q in easy.questions] == ["c1", "w1", "c2", "c3", "i1"]


def test_one_sentence_is_never_asked_twice():
    twin = row("c-twin", "cloze", quality=0.99, evidence="same sentence")
    questions = [row("m1", "multiple_choice", evidence="same sentence"), twin, row("c2", "cloze", quality=0.5)]
    assert picked(questions) == ["m1", "c2"]


def test_no_two_questions_share_an_answer():
    questions = [
        row("m1", "multiple_choice", answer="design"), row("m2", "multiple_choice", answer="Design "),
        row("c1", "cloze", answer="design", quality=0.99), row("c2", "cloze", answer="antenna", quality=0.5),
    ]
    assert picked(questions) == ["m1", "c2"]


def test_questions_are_spread_over_the_chunks_of_the_session():
    questions = [row(f"c{i}", "cloze", chunk_index=0, quality=0.9) for i in range(4)]
    questions += [row("far", "cloze", chunk_index=1, quality=0.6)]
    assert picked(questions, mix=[(["cloze"], 2)], count=2) == ["c0", "far"]


def test_fewer_questions_than_asked_for_returns_what_exists():
    assert picked([row("i1", "main_idea"), row("c1", "cloze")]) == ["c1", "i1"]
    assert picked([]) == []


def test_the_mix_can_be_overridden_and_main_idea_stays_last():
    ids = picked(bank(), mix=[(["main_idea"], 1), (["why_how"], 1), (["cloze"], 3)])
    assert ids == ["w1", "c1", "c2", "c3", "i1"]
    assert picked(bank()) == picked(list(reversed(bank())))  # the order of the rows does not matter


def test_session_question_keeps_what_grading_needs_and_lists_the_options():
    question = assembler.session_question(row("m1", "multiple_choice"))
    assert sorted(question["options"]) == ["answer m1", "wrong 1", "wrong 2", "wrong 3"]
    assert question["options"] == assembler.session_question(row("m1", "multiple_choice"))["options"]
    assert question["question"].startswith("prompt m1\n") and all(o in question["question"] for o in question["options"])
    assert (question["answer"], question["evidence"], question["key_terms"]) == ("answer m1", "evidence m1", ["term m1"])
    assert question["guidance"] and question["id"] == "m1" and question["type"] == "factual"
    places = {assembler.session_question(row(f"m{i}", "multiple_choice"))["options"].index(f"answer m{i}")
              for i in range(20)}
    assert len(places) > 1  # the right option is not always in the same place
    open_question = assembler.session_question(row("c1", "cloze"))
    assert open_question["question"] == "prompt c1" and "options" not in open_question


def test_public_question_has_no_answer_evidence_or_hints():
    for source in (row("m1", "multiple_choice"), row("w1", "why_how")):
        stored = assembler.session_question(source)
        stored["cached_eval"] = {"score": 3, "feedback": "The answer is answer m1"}
        public = assembler.public_question(stored)
        assert set(public) <= {"question", "type", "options"}
        assert public["question"] == stored["question"] and public["type"] == stored["type"]
    assert assembler.public_question({"question": "Old LLM question?", "type": "factual", "guidance": "hint"}) == {
        "question": "Old LLM question?", "type": "factual",
    }


def test_fallback_question_is_open_and_has_no_bank_row():
    question = assembler.fallback_question()
    assert question["type"] == "summary" and question["id"] is None and question["question"]
