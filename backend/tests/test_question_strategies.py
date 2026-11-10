"""Question strategies on fixed text: no model, no database, no network."""

import pytest

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


@pytest.mark.parametrize("chunk, label, prompt", [
    ("Photosynthesis is the process that feeds a plant.", "photosynthesis", "What is photosynthesis?"),
    ("Enzymes are the proteins that speed up reactions in a cell.", "enzyme", "What are enzymes?"),
    ("Chlorophyll refers to a group of green pigments.", "chlorophyll", "What is chlorophyll?"),
    ("Green pigment is defined as chlorophyll in most textbooks.", "chlorophyll", "What is chlorophyll?"),
    ("Plants use a pigment known as chlorophyll to trap light.", "chlorophyll", "What is chlorophyll?"),
    ("Osmosis is defined as the movement of water across a membrane.", "osmosis", "What is osmosis?"),
    ("DNA is the molecule that carries genetic information.", "dna", "What is DNA?"),
])
def test_definition_patterns(chunk, label, prompt):
    (question,) = strategies.definition(strategies.sentences_of(chunk), [concept(label, 1.0)])
    assert question.prompt == prompt
    assert question.answer == chunk and question.evidence == [chunk]
    assert (question.type, question.strategy, question.concept) == ("factual", "definition", label)


@pytest.mark.parametrize("chunk, label", [
    ("Plants absorb light energy quickly in summer.", "plant"),              # no definitional pattern
    ("In bright summer light, plants are the main producers.", "plant"),    # not the subject
    ("The answer is the same thing in most cases.", "plant"),               # no concept
    ("Chlorophyll is green and absorbs red light.", "chlorophyll"),         # "is" + adjective
])
def test_definition_ignores_other_sentences(chunk, label):
    assert strategies.definition(strategies.sentences_of(chunk), [concept(label, 1.0)]) == []


def test_definition_on_the_fixture_chunk():
    questions = strategies.definition(SENTENCES, CONCEPTS)
    assert [q.prompt for q in questions] == [
        "What is photosynthesis?", "What is chlorophyll?", "What is chlorophyll?",
    ]
    assert questions[0].answer == SENTENCES[0].text
    assert "sunlight" in questions[0].key_terms and "photosynthesis" not in questions[0].key_terms
    assert len(questions[0].key_terms) <= policy.KEY_TERMS_MAX
    assert_evidence_is_verbatim(questions)


def test_strategies_are_deterministic_and_handle_empty_input():
    assert strategies.cloze(SENTENCES, CONCEPTS) == strategies.cloze(strategies.sentences_of(CHUNK), CONCEPTS)
    assert strategies.sentences_of("") == []
    assert strategies.cloze([], CONCEPTS) == [] and strategies.definition([], CONCEPTS) == []
    assert strategies.cloze(SENTENCES, []) == [] and strategies.definition(SENTENCES, []) == []


CAUSAL = (
    "Leaves look green because chlorophyll reflects green light. "
    "Because the days grow shorter, trees stop making chlorophyll. "
    "The pigment breaks down in autumn, and as a result the leaves turn yellow. "
    "Sunlight is weaker in winter.\nTherefore, photosynthesis slows down sharply. "
    "Heavy rain leads to soil erosion on bare slopes. Deserts are dry."
)


def test_why_how_asks_for_the_causal_clause():
    sentences = strategies.sentences_of(CAUSAL)
    questions = strategies.why_how(sentences)
    assert [(q.prompt, q.answer) for q in questions] == [
        ('According to the passage, why is this so: "Leaves look green"?',
         "because chlorophyll reflects green light"),
        ('According to the passage, why is this so: "Trees stop making chlorophyll"?',
         "because the days grow shorter"),
        ('According to the passage, why is this so: "The leaves turn yellow"?',
         "The pigment breaks down in autumn"),
        ('According to the passage, why is this so: "Photosynthesis slows down sharply"?',
         "Sunlight is weaker in winter."),
        ("According to the passage, what leads to soil erosion on bare slopes?", "Heavy rain"),
    ]
    assert all((q.type, q.strategy) == ("inference", "why_how") for q in questions)
    assert questions[0].key_terms == ["chlorophyll", "reflects", "green", "light"]
    # A marker that opens a sentence points back: both sentences are the evidence.
    assert questions[3].evidence == [sentences[3].span, sentences[4].span]
    assert all(len(q.evidence) == 1 for q in questions if q is not questions[3])
    assert_evidence_is_verbatim(questions, CAUSAL)


@pytest.mark.parametrize("chunk", [
    "Therefore, the harvest failed that year.",            # opens the chunk: no earlier sentence
    "The process is therefore much slower at night.",      # not between two clauses
    "Because it rained.",                                  # no main clause
    "It leads to rot in the roots of the plant.",          # the cause is only a pronoun
    "Roots take up water and minerals from the soil.",     # no causal marker
])
def test_why_how_needs_a_marker_and_two_clauses(chunk):
    assert strategies.why_how(strategies.sentences_of(chunk)) == []
