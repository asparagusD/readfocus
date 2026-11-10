"""Question strategies on fixed text: no model, no database, no network."""

from backend.agents import policy
from backend.agents.question_generation import strategies
from backend.nlp.concepts import Concept

# Line breaks inside sentences, as PDF extraction leaves them.
CHUNK = (
    "Photosynthesis is the process by which green plants turn sunlight\n"
    "into chemical energy. It happens in the chloroplasts.\n\n"
    "Plants absorb light energy through a pigment known as chlorophyll, which gives leaves\n"
    "their green colour. Chlorophyll refers to a group of green pigments found in plants and algae. "
    "Wow!"
)


def concept(label: str, weight: float) -> Concept:
    return Concept(key=label.replace(" ", "-"), label=label, weight=weight)


CONCEPTS = [
    concept("photosynthesis", 1.0),
    concept("chlorophyll", 0.9),
    concept("light energy", 0.8),
    concept("plant", 0.6),
]
SENTENCES = strategies.sentences_of(CHUNK)


def assert_evidence_is_verbatim(questions, chunk=CHUNK):
    assert questions
    for question in questions:
        assert question.evidence, question.prompt
        for piece in question.evidence:
            assert piece in chunk, f"not in the chunk: {piece!r}"


def test_sentences_keep_the_exact_span_of_the_chunk():
    assert len(SENTENCES) == 5
    assert all(sentence.span in CHUNK for sentence in SENTENCES)
    assert "\n" in SENTENCES[0].span and "\n" not in SENTENCES[0].text
    assert SENTENCES[0].text.endswith("turn sunlight into chemical energy.")
    assert [sentence.index for sentence in SENTENCES] == [0, 1, 2, 3, 4]


def test_sentences_find_spans_with_curly_quotes():
    chunk = "The plant’s leaves are “green” in summer. They fall in autumn."
    found = strategies.sentences_of(chunk)
    assert [s.span for s in found] == ["The plant’s leaves are “green” in summer.", "They fall in autumn."]
    assert found[0].text == "The plant's leaves are \"green\" in summer."


def test_a_sentence_that_normalising_rewrote_is_dropped():
    chunk = "Leaves hold chloro-\nphyll in their cells. Roots take up water from the soil."
    assert [s.text for s in strategies.sentences_of(chunk)] == ["Roots take up water from the soil."]


def test_cloze_blanks_the_highest_weight_concept_of_the_sentence():
    questions = strategies.cloze(SENTENCES, CONCEPTS)
    assert [q.answer for q in questions] == ["Photosynthesis", "chlorophyll", "Chlorophyll"]
    first = questions[0]
    assert first.prompt == (
        f"Fill in the blank: {policy.BLANK} is the process by which green plants turn sunlight into chemical energy."
    )
    assert (first.type, first.strategy, first.concept) == ("factual", "cloze", "photosynthesis")
    assert first.key_terms == ["photosynthesis"]
    for question in questions:
        assert question.answer.lower() not in question.prompt.lower()
        assert question.answer in question.evidence[0]
    assert_evidence_is_verbatim(questions)


def test_cloze_matches_plurals_and_blanks_every_occurrence():
    plants = strategies.cloze(SENTENCES, [concept("plant", 1.0)])
    assert [q.answer for q in plants] == ["plants", "Plants", "plants"]
    chunk = "Energy is stored as chemical energy inside the sugar molecules of a leaf."
    (question,) = strategies.cloze(strategies.sentences_of(chunk), [concept("energy", 1.0)])
    assert question.prompt.count(policy.BLANK) == 2 and "nergy" not in question.prompt


def test_cloze_skips_sentences_with_no_concept_or_little_content():
    assert strategies.cloze(SENTENCES, [concept("mitochondria", 1.0)]) == []
    # "It happens in the chloroplasts." has the concept but scores too low to ask about.
    assert strategies.cloze(SENTENCES, [concept("chloroplast", 1.0)]) == []


def test_strategies_are_deterministic_and_handle_empty_input():
    assert strategies.cloze(SENTENCES, CONCEPTS) == strategies.cloze(strategies.sentences_of(CHUNK), CONCEPTS)
    assert strategies.sentences_of("") == []
    assert strategies.cloze([], CONCEPTS) == [] and strategies.cloze(SENTENCES, []) == []
