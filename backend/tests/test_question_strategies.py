"""Question strategies on fixed text: no model, no database, no network."""

import numpy as np
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


# One 2-d vector per sentence of CHUNK. The mean points along (0.78, 0.62);
# sentences 1 and 3 are the closest to it (cosine 0.84 and 0.81).
SENTENCE_VECTORS = np.array([[1, 0], [0.9, 0.1], [0, 1], [1, 0.05], [-0.2, 1]], dtype=np.float32)


def test_main_idea_cites_the_two_sentences_nearest_the_centroid():
    (question,) = strategies.main_idea(SENTENCES, CONCEPTS, SENTENCE_VECTORS)
    assert question.prompt == (
        "In your own words, what is the main idea of this passage about photosynthesis?"
    )
    assert question.evidence == [SENTENCES[1].span, SENTENCES[3].span]
    assert question.answer == f"{SENTENCES[1].text} {SENTENCES[3].text}"
    assert (question.type, question.strategy, question.concept) == ("summary", "main_idea", "photosynthesis")
    assert question.key_terms == ["photosynthesis", "chlorophyll", "light energy", "plant"]
    assert_evidence_is_verbatim([question])


def test_main_idea_edge_cases():
    one = strategies.sentences_of("Roots take up water from the soil.")
    (question,) = strategies.main_idea(one, [], np.array([[0.3, 0.4]]))
    assert question.prompt == "In your own words, what is the main idea of this passage?"
    assert question.evidence == ["Roots take up water from the soil."] and question.concept is None
    assert strategies.main_idea([], CONCEPTS, np.zeros((0, 2))) == []
    with pytest.raises(ValueError):
        strategies.main_idea(SENTENCES, CONCEPTS, SENTENCE_VECTORS[:3])


def at(degrees: float) -> np.ndarray:
    """A unit vector; the cosine between two of them is the cosine of the angle between."""
    return np.array([np.cos(np.radians(degrees)), np.sin(np.radians(degrees))])


# Cosine to photosynthesis (0 degrees) in brackets; the band is 0.40 to 0.75.
BOOK_CONCEPTS = {
    "photosynthesis": at(0),
    "chlorophyll": at(10),
    "osmosis": at(30),        # 0.87: too close, could also be right
    "glycolysis": at(45),     # 0.71
    "respiration": at(50),    # 0.64
    "plant": at(55),          # 0.57, but the sentence itself says "plants"
    "fermentation": at(60),   # 0.50
    "digestion": at(65),      # 0.42
    "tax law": at(85),        # 0.09: too far to be plausible
}


def test_multiple_choice_adds_three_plausible_distractors_from_the_book():
    cloze = strategies.cloze(SENTENCES, CONCEPTS)
    (question,) = strategies.multiple_choice(cloze, BOOK_CONCEPTS)
    assert question.distractors == ["glycolysis", "respiration", "fermentation"]
    assert question.answer == "Photosynthesis" and question.concept == "photosynthesis"
    assert question.prompt == (
        f"Choose the answer that fills the blank: {policy.BLANK} is the process by which green plants "
        "turn sunlight into chemical energy."
    )
    assert (question.type, question.strategy) == ("factual", "multiple_choice")
    assert question.evidence == cloze[0].evidence
    assert_evidence_is_verbatim([question])


def test_multiple_choice_needs_three_distractors_and_a_vector_for_the_answer():
    cloze = strategies.cloze(SENTENCES, CONCEPTS)
    # chlorophyll (10 degrees) has only fermentation and digestion in the band.
    assert all(q.concept != "chlorophyll" for q in strategies.multiple_choice(cloze, BOOK_CONCEPTS))
    without_answer = {label: vector for label, vector in BOOK_CONCEPTS.items() if label != "photosynthesis"}
    assert strategies.multiple_choice(cloze[:1], without_answer) == []
    assert strategies.multiple_choice(cloze, {}) == [] and strategies.multiple_choice([], BOOK_CONCEPTS) == []


def test_multiple_choice_skips_distractors_that_share_a_word_with_the_answer():
    chunk = "Leaves store light energy as sugar during the long days of summer."
    cloze = strategies.cloze(strategies.sentences_of(chunk), [concept("light energy", 1.0)])
    book = {"light energy": at(0), "heat energy": at(50), "glycolysis": at(45), "respiration": at(50),
            "fermentation": at(60)}
    (question,) = strategies.multiple_choice(cloze, book)
    assert question.distractors == ["glycolysis", "respiration", "fermentation"]
