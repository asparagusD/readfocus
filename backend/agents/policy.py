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

# Fixed difficulty per strategy, 0 (easy) to 1 (hard).
DIFFICULTY = {
    "cloze": 0.3,
}
