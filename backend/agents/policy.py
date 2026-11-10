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
