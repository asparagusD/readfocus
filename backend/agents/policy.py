"""Policy constants for the agents: every threshold, weight and limit.

Agents read these; they hold no numbers of their own. Change behaviour
here, and cover the boundary in the agent's tests.
"""

# --- Question generation (backend/agents/question_generation/) -------------

# What a blanked-out answer looks like in a cloze prompt.
BLANK = "_____"

# A sentence must score at least this on backend.nlp.text.informativeness
# (0..1) before a cloze question is made from it.
CLOZE_MIN_INFORMATIVENESS = 0.6

# "X is a ...": at most this many words may stand before X for X to count as
# the subject being defined ("Green plants are the ...").
DEFINITION_MAX_LEAD_WORDS = 2

# Why/how: the fewest words the stated fact and its cause may have. One-word
# causes are pronouns ("It leads to ...") and cannot be graded.
WHY_MIN_STATEMENT_WORDS = 3
WHY_MIN_CAUSE_WORDS = 2

# Main idea: how many sentences nearest the chunk's centroid are the evidence.
MAIN_IDEA_SENTENCES = 2

# Multiple choice: distractors per question, and the band of cosine
# similarity to the answer a distractor must fall in. Above the band it may
# be a second right answer; below it nobody would pick it.
DISTRACTOR_COUNT = 3
DISTRACTOR_MIN_COSINE = 0.40
DISTRACTOR_MAX_COSINE = 0.75

# --- Question quality (backend/agents/question_generation/quality.py) ------

# Evidence with fewer word tokens than this is a heading or a fragment, not
# a sentence to ask about.
QUALITY_MIN_EVIDENCE_TOKENS = 8

# Two prompts whose embeddings have a cosine above this are the same
# question; the one with the higher quality stays.
QUALITY_DUPLICATE_COSINE = 0.9

# Quality is a weighted sum of three parts, each 0..1; the weights sum to 1.
QUALITY_WEIGHTS = {
    "evidence": 0.6,   # informativeness of the evidence sentences
    "answer": 0.2,     # answer short enough to grade
    "key_terms": 0.2,  # key terms to grade it by
}

# Answer length in word tokens: full marks up to the first, none at the second.
QUALITY_ANSWER_TOKENS = (25, 60)

# This many key terms earn the full key-term part.
QUALITY_KEY_TERMS_FULL = 3

# Boilerplate: a sentence of at least this many words is a table row when
# this share of its tokens are numbers, and a title or list of names when
# this share of its words start with a capital.
BOILERPLATE_MIN_WORDS = 6
BOILERPLATE_DIGIT_SHARE = 0.4
BOILERPLATE_CAPITALISED_SHARE = 0.6

# Most questions kept per chunk for each strategy, best quality first.
QUESTION_CAPS = {
    "cloze": 5,
    "multiple_choice": 3,
    "definition": 3,
    "why_how": 3,
    "main_idea": 1,
}
QUESTION_CAP_DEFAULT = 3  # a strategy not listed above

# Most questions stored for one chunk, over all strategies.
MAX_QUESTIONS_PER_CHUNK = 12

# --- Test assembly (backend/agents/question_generation/assembler.py) -------

# Questions in one session test.
TEST_QUESTION_COUNT = 5

# The default mix: (strategies that may fill the place, how many places).
# Places that cannot be filled go to the best of the remaining questions.
TEST_MIX = [
    (["multiple_choice"], 2),
    (["cloze"], 1),
    (["definition", "why_how"], 1),
    (["main_idea"], 1),
]

# Difficulty (0..1) a question should be near when nothing is known about
# the reader; the optimizer can pass another value.
TEST_TARGET_DIFFICULTY = 0.4

# Most key terms stored with one question.
KEY_TERMS_MAX = 6

# Fixed difficulty per strategy, 0 (easy) to 1 (hard).
DIFFICULTY = {
    "cloze": 0.3,
    "definition": 0.4,
    "why_how": 0.6,
    "main_idea": 0.7,
    "multiple_choice": 0.2,
}

# --- Grading (backend/agents/evaluation/grader.py) --------------------------

# Cloze and multiple choice: a rapidfuzz ratio (0..100) at or above this is
# the expected answer, misspelt or not.
GRADE_FUZZY_RATIO = 90.0

# Below the threshold but at or above this, the answer may be a worse
# misspelling of the right word: half marks, always at low confidence.
GRADE_NEAR_MISS_RATIO = 80.0
GRADE_NEAR_MISS_SCORE = 0.5

# Free text: score = sum of weight * component, each component 0..1.
GRADE_WEIGHTS = {
    "cosine": 0.55,     # meaning: cosine(answer, evidence), rescaled
    "coverage": 0.35,   # share of the question's key terms in the answer
    "relevance": 0.10,  # sanity check: the answer is about the passage
}

# Raw cosine (all-MiniLM-L6-v2) to the 0..1 cosine component: nothing at or
# below the floor, full at or above the value a faithful paraphrase reaches.
# Tuned on backend/tests/fixtures/answers.json (C6.2): the floor started at
# 0.2 (25 of 34 cases agree); 0.1 gives 26. Over floors 0.0 to 0.3 and full
# values 0.65 to 0.85 the count stays between 24 and 27.
GRADE_COSINE_FLOOR = 0.1
GRADE_COSINE_FULL = 0.75

# Relevance uses the larger of cosine(answer, evidence) and cosine(answer,
# question): none at the floor (unrelated text), full once clearly on topic.
GRADE_RELEVANCE_FLOOR = 0.15
GRADE_RELEVANCE_FULL = 0.35

# A raw cosine in this band can be a loose right answer or a fluent wrong
# one: low confidence. Within the margin of the band: medium.
GRADE_AMBIGUOUS_COSINE = (0.45, 0.60)
GRADE_AMBIGUOUS_MARGIN = 0.05

# A free-text answer with fewer word tokens than this is low confidence.
GRADE_MIN_TOKENS = 4

# The most a free-text grade may claim. Measured in C6.2: answers that
# reverse the evidence in its own words scored 0.86 and 0.91, so a
# semantic grade is never "high".
GRADE_FREE_TEXT_MAX_CONFIDENCE = "medium"

# Cosine and coverage components this far apart are a disagreement: medium.
GRADE_DISAGREEMENT = 0.6

# An answer this close to the question (rapidfuzz ratio), or made only of
# the question's words, is a copy of it: no credit, low confidence.
GRADE_COPY_RATIO = 90.0

# Calibration against backend/tests/fixtures/answers.json: a grade agrees
# with the human one within the tolerance; the share that must agree.
GRADE_AGREEMENT_TOLERANCE = 0.25
GRADE_AGREEMENT_TARGET = 0.75

# --- Feedback (backend/agents/evaluation/feedback.py) -----------------------

# Longest evidence quotation in a feedback message, in characters; a longer
# sentence is cut at a word and ends with an ellipsis.
FEEDBACK_SNIPPET_CHARS = 160

# Most key terms named as captured, and as missed.
FEEDBACK_MAX_TERMS = 3

# A free-text answer to a question with no key terms is "close to the
# passage" at or above this score.
FEEDBACK_CLOSE_SCORE = 0.6

# --- Evaluator (backend/agents/evaluator_agent.py) --------------------------

# Points per question in a stored result: the grader's 0..1 score times this.
GRADE_POINTS = 10

# A question with no evidence of its own is graded against this many of the
# passage's most informative sentences, always at low confidence.
GRADE_FALLBACK_SENTENCES = 3

# --- Knowledge state (backend/agents/knowledge_state/mastery.py) ------------

# Mastery (0..1) of a concept the reader has not been tested on yet; the
# default of user_concept_mastery.mastery in migration 008.
MASTERY_PRIOR = 0.3

# A graded question's 0..1 score is correct at or above the first, wrong
# below the second, and partial in between.
MASTERY_CORRECT_FROM = 0.7
MASTERY_WRONG_BELOW = 0.4

# A correct answer closes this share of the gap to 1; a wrong one takes this
# share of the mastery away. Partial credit lands between the two results,
# in proportion to the score.
MASTERY_GAIN = 0.30
MASTERY_LOSS = 0.25

# How much of that move a grade makes, by the grader's confidence.
MASTERY_CONFIDENCE_WEIGHT = {"high": 1.0, "medium": 1.0, "low": 0.5}

# Days until the next review: (mastery below this, days), first match wins;
# at or above the last bound, the maximum.
MASTERY_REVIEW_DAYS = [(0.4, 1), (0.6, 3), (0.8, 7)]
MASTERY_REVIEW_DAYS_MAX = 14
