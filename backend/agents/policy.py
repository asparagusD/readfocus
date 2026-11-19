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
# Re-measured in C15.3 (scripts/eval_grader.py --search): over 3,060
# combinations of these weights and the four cosine/relevance bounds below,
# the best fit on answers.json is 28 of 34 (cosine 0.35, coverage 0.25,
# relevance 0.40), but leave-one-out gives 26 of 34, the same as these
# values, and the mean error does not improve; kept. The misses are answers
# that reverse the evidence (cosine 0.78-1.0) and paraphrases that use few
# key terms: no weighting of these signals separates them.
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

# --- Reading strategy (backend/agents/planner/strategy.py) ------------------

# A candidate chunk's score: the weighted sum of four 0..1 components.
PLANNER_WEIGHTS = {
    "weak_concept_coverage": 0.35,  # share of its concepts the reader is weak on
    "unread": 0.25,                 # 1 for the next unread section, 0 for one already read
    "difficulty_fit": 0.20,         # how close its difficulty is to the reader's target
    "due_for_review": 0.20,         # share of its concepts whose next review has come
}

# A concept the reader has been tested on is weak below this mastery; an
# untested one is never weak, whatever its prior.
PLANNER_WEAK_BELOW = 0.5

# Target difficulty from the mean of the last few test percentages: below
# the low score, at or above the high score, or in between (and with no
# history). A chunk's fit falls linearly to 0 at this distance from the target.
PLANNER_RECENT_TESTS = 3
PLANNER_LOW_SCORE = 0.5
PLANNER_HIGH_SCORE = 0.8
PLANNER_TARGET_DIFFICULTY = {"low": 0.3, "mid": TEST_TARGET_DIFFICULTY, "high": 0.6}
PLANNER_DIFFICULTY_SPAN = 0.5
PLANNER_UNKNOWN_DIFFICULTY_FIT = 0.5  # a chunk with no difficulty estimate

# Words in a new-reading session before the optimizer's multiplier, the
# bounds on that multiplier, and the most sections in one session. A
# section longer than the target is still read whole, alone.
PLANNER_BASE_WORDS = 600
PLANNER_MULTIPLIER_RANGE = (0.5, 2.0)
PLANNER_MAX_CHUNKS = 3

# Reading speed when the profile has none, extra time for re-reading,
# review or low recent scores, and the bounds on a session's minutes.
PLANNER_DEFAULT_WPM = 200
PLANNER_SLOW_BUFFER = 0.10
PLANNER_MINUTES_RANGE = (10, 120)

# Test mix per session mode, in the assembler's TEST_MIX form. Re-reading
# and review lean on recall (cloze, definitions) of what was missed.
PLANNER_QUESTION_MIX = {
    "new": TEST_MIX,
    "re_read": [(["cloze"], 2), (["multiple_choice"], 1), (["definition", "why_how"], 1), (["main_idea"], 1)],
    "review": [(["cloze"], 2), (["definition"], 1), (["multiple_choice"], 1), (["why_how", "main_idea"], 1)],
}

# --- Learning optimizer (backend/agents/optimizer/pace.py) ------------------

# Score bands on a 0..100 percentage: (from, band, multiplier factor), first
# match wins. The old optimizer's 40 / 25 / 10 of 50 points. The band of the
# rolling mean sets the factor; the band of this test alone decides re-reading.
OPT_BANDS = [(80.0, "grow", 1.15), (50.0, "hold", 1.0), (20.0, "reduce", 0.80), (0.0, "fail", 0.50)]

# The rolling mean covers this test and the ones before it, this many in all.
OPT_ROLLING_TESTS = 3

# Abandoned sessions among the last few: at the limit, the factor is at most
# this, so sessions shrink instead of growing.
OPT_ABANDON_WINDOW = 5
OPT_ABANDON_LIMIT = 2
OPT_ABANDON_FACTOR = 0.80

# The measured reading speed (words over actual minutes) is used within
# these multiples of the profile speed.
OPT_SPEED_RANGE = (0.5, 1.5)

# Most sections waiting in the re-read queue; the oldest fall off the end.
OPT_REREAD_QUEUE_MAX = 5

# A question type fails when its mean score (0..1) over at least this many
# recent answers is below the bound; it gets one place more next test, from
# the passing group with most places. Every group keeps its places in range.
OPT_TYPE_FAIL_BELOW = 0.5
OPT_TYPE_MIN_SAMPLES = 2
OPT_MIX_PLACES_RANGE = (1, 3)

# Recent question outcomes (strategy, 0..1 score) kept with the pace
# recommendation, newest first, for the per-type failure rule.
OPT_OUTCOME_HISTORY = 15

# --- Evaluator (backend/agents/evaluator_agent.py) --------------------------

# reading_progress.average_score is the mean of this many latest tests (this
# one included); the value the evaluator used before C8 follow-up.
ROLLING_AVERAGE_TESTS = 10

# --- Original book files (backend/routers/books.py, C17.1) -------------------

# Bytes of original files a reader may keep on our server (storage_mode
# 'cloud'); device-only books do not count. Supabase Free storage is shared
# by every reader, so this is a fairness cap, not a quota we sell.
MAX_SHELF_BYTES_PER_USER = 300 * 1024 * 1024
# One upload is read into memory on Render Free, so it stops here.
MAX_BOOK_FILE_BYTES = 50 * 1024 * 1024
# C26.7: a book over MAX_BOOK_FILE_BYTES stays on the reader's device and its browser sends only the text
# (POST /books/device, then POST /books/{id}/pages). The cap is browser memory on phones (decided 2026-11-17).
MAX_DEVICE_BOOK_FILE_BYTES = 300 * 1024 * 1024
BROWSER_TEXT_PAGES_PER_BATCH = 50      # pages (an EPUB's spine documents) in one POST /books/{id}/pages
BROWSER_TEXT_MAX_PAGE_CHARS = 60_000   # one page's text; a page of dense prose is about 3,000
BROWSER_TEXT_MAX_PAGES = 10_000
# Lifetime of the signed URL GET /books/{id}/file and /open return. C35.8a (issue 19): one URL per book is handed
# out again (services/file_url.py) so the CDN's cached copy is reused; it is replaced once less than MIN_LEFT is left.
BOOK_FILE_URL_SECONDS = 3600
BOOK_FILE_URL_MIN_LEFT = 900

# --- Converted sources (backend/convert/sources.py, C19.2c) ------------------

# A .zip of Markdown and images is unpacked in memory on Render Free: at most
# this many entries and this many bytes once unpacked (a zip bomb stops here).
MAX_CONVERT_ZIP_ENTRIES = 2000
MAX_CONVERT_UNPACKED_BYTES = 100 * 1024 * 1024

# --- Scanned pages and OCR (backend/services/ocr_pages.py, C19.4) ------------

# A PDF page whose pypdf text has fewer visible characters than this has no
# text layer worth reading: it is flagged in books.scanned_pages for OCR.
OCR_MIN_PAGE_CHARS = 20
# tesseract's word confidence (0-100) below which a word is dropped.
OCR_MIN_CONFIDENCE = 60
# A word longer than this is not a word (a run-on of misread marks).
OCR_MAX_WORD_CHARS = 48
# Words one page may post; a dense page has about 600.
OCR_MAX_WORDS_PER_PAGE = 4000
# A figure covering at least this share of the page is the scan itself, not a drawing, so OCR may read it.
OCR_FULL_PAGE_FIGURE = 0.8

# --- Annotations (backend/routers/annotations.py, C21.1; docs/ANCHORS.md) -----

# The handoff's highlight palette (tokens --hl-<name>) and the two styles; migration 026 checks the same lists.
ANNOTATION_COLORS = ("honey", "sage", "sky", "rose", "lilac")
ANNOTATION_STYLES = ("highlight", "underline")
# Anchors one annotation may hold: one per PDF page or EPUB spine item it crosses (A2).
ANNOTATION_ANCHORS_MAX = 16
# Characters of text kept with an annotation (A1 text, whitespace collapsed).
ANNOTATION_TEXT_MAX = 5_000
# Annotations one list request returns, in reading order.
ANNOTATIONS_LIST_MAX = 2_000

# --- Note blocks (backend/routers/notes.py, C22.1; docs/ANCHORS.md) -------------

# Block kinds and anchoring scopes (a selection, or the pages shown); migration 027 checks the same lists.
NOTE_KINDS = ("text", "drawing", "equation", "code", "figure")
NOTE_SCOPES = ("selection", "view")
# One block's content as JSON, also a check in 027 (octet_length of content::text).
NOTE_CONTENT_MAX_BYTES = 262_144
NOTE_TEXT_MAX = 20_000  # characters of text in a text block
NOTE_DOC_DEPTH_MAX = 12  # nesting of a TipTap document
NOTE_CODE_MAX = 20_000
NOTE_LATEX_MAX = 4_000
NOTE_CAPTION_MAX = 1_000
NOTE_DRAWING_ELEMENTS_MAX = 2_000
NOTE_DRAWING_FILES_MAX = 20
# A code block's language ("" for none); the region map's language guesses (A9) are among them.
NOTE_CODE_LANGUAGES = ("", "python", "javascript", "typescript", "java", "c", "cpp", "csharp", "go", "rust",
                       "ruby", "php", "swift", "kotlin", "scala", "r", "matlab", "julia", "haskell", "scheme", "sql",
                       "bash", "html", "css", "json", "yaml", "xml", "latex", "text")
# Images and thumbnails in the private "notes" bucket (027 sets the same limit and types).
NOTE_FILE_BYTES_MAX = 262_144
NOTE_FILE_TYPES = ("image/webp", "image/png")
NOTE_FILE_URL_SECONDS = 3_600
# Note blocks one list request returns, in reading order.
NOTES_LIST_MAX = 2_000

# --- Body start (C23.1, docs/FOCUS_RULES.md F2) ------------------------------------------------------------
# How books.body_start was found (028 checks the same values): the outline, a heading in the region map, the
# first page after the contents with enough prose, or the reader's own choice (which always wins).
BODY_START_SOURCES = ("outline", "heading", "prose", "user")
# Outline entries that are front matter, never the body (matched at the start of the title, lower case).
BODY_START_FRONT_MATTER = (
    "cover", "title", "half title", "halftitle", "frontispiece", "copyright", "imprint", "contents",
    "table of contents", "dedication", "epigraph", "foreword", "preface", "acknowledgments", "acknowledgements",
    "about the author", "about the authors", "list of figures", "list of tables", "list of illustrations",
    "illustrations", "abbreviations", "praise", "also by", "other books by", "introduction", "note on the text",
    "a note on", "how to use this book", "maps",
)
BODY_START_MIN_PROSE_WORDS = 300  # (3) a page or EPUB section with at least this much prose
BODY_START_HEADING_MAX_CHARS = 80  # a region's first line longer than this is not a heading
BODY_START_HEADING_TOP = 3  # a numbered heading ("1 Springs") is among the first regions of its page
BODY_START_CONTENTS_LINES = 3  # a page with this many chapter-like lines is a contents page
BODY_START_SCAN_UNITS = 80  # (2) and (3) look at the first pages or EPUB sections only
BODY_START_TITLE_MAX = 200

# --- Focus mode (C23, docs/FOCUS_RULES.md: the defaults table there is the source; test_focus_policy.py checks) ---
FOCUS_POINTS_PER_MINUTE = 10  # F4
FOCUS_HEARTBEAT_S = 30  # F3: the tab sends one every 30 s while visible (C23.6)
FOCUS_IDLE_PROMPT_MIN = 10  # F6
FOCUS_IDLE_ANSWER_S = 60  # F6
FOCUS_PAGE_CAP_MIN = 30  # F7
FOCUS_SESSION_CAP_MIN = 180  # F8
QUIZ_WORDS_PER_QUESTION = 400  # F10
QUIZ_MIN_QUESTIONS = 3  # F10
QUIZ_MAX_QUESTIONS = 15  # F10
# C36.G: a quiz makes the missing questions of at most this many of its range's chunks itself, spread across the
# range (3-7 s each at Render's 0.1 CPU); the reader's own questions (reader_questions) cover the rest as it reads.
QUIZ_TOPUP_MAX_CHUNKS = 4
QUIZ_POINTS_PER_CORRECT = 20  # F11
QUIZ_PASS_SCORE = 0.40  # F12
FOCUS_MAX_GAP_S = 45  # F3: two heartbeats further apart than this credit nothing between them
FOCUS_MIN_HEARTBEAT_GAP_S = 5  # F3: a heartbeat sooner than this after the last one counted is ignored
FOCUS_HEARTBEAT_RATE_S = 25  # F3: the API stores at most one heartbeat per this many seconds; extras are counted
FOCUS_EVENT_RATE_S = 2  # F3: and at most one other event of the same kind per this many seconds
QUIZ_CORRECT_FROM = MASTERY_CORRECT_FROM  # F11: an answer scoring this share of its maximum is correct
QUIZ_LOW_CONFIDENCE_WEIGHT = 0.5  # F11: a correct answer the grader is unsure of counts half
FOCUS_ABANDON_AFTER_MIN = 120  # F1: an open session with no event for this long is abandoned (0 points)
# focus_sessions.status and focus_events.kind (029 checks the same values). Open sessions: one per reader.
FOCUS_STATUSES = ("active", "paused", "awaiting_quiz", "scored", "abandoned")
FOCUS_OPEN_STATUSES = ("active", "paused")
FOCUS_EVENT_KINDS = ("start", "heartbeat", "page_turn", "hidden", "visible", "idle_prompt", "idle_confirm",
                     "pause", "resume", "end")
FOCUS_PAGE_KEY_MAX = 64  # focus_events.page_key: "p12" or "s3:4"
# Stored on each session at its start and again when it is scored, so the row names the rules that scored it.
# A date, with ".n" for a later revision the same day. 2026-11-15.2: the quiz bonus is capped at the time points.
FOCUS_RULES_VERSION = "2026-11-15.2"

# --- XP, the daily goal and streaks (C24.1, docs/GAMIFICATION.md G4-G9) ---
XP_SOURCES = ("focus", "badge", "adjustment")  # xp_events.source (031 checks the same values); only focus earns in C24
DAILY_GOAL_XP = 50  # G5: the default daily goal, in XP (five active minutes)
DAILY_GOAL_MIN_XP = 10  # G5: the reader may set it within these bounds
DAILY_GOAL_MAX_XP = 500
STREAK_FREEZE_MAX = 2  # G8: freezes held at most
STREAK_FREEZE_EVERY_DAYS = 7  # G8: one earned at every 7 consecutive counted days, while fewer than the max held
XP_TIMEZONE_MAX = 64  # user_progress.timezone: an IANA name such as "America/Argentina/ComodRivadavia"
DISPLAY_NAME_MAX = 40  # user_progress.display_name, shown on leaderboards (G3)
TECH_BOOK_SHARE = 0.20  # Badges: a book is technical when this share of its page regions is math or code

# --- weekly leagues (C24.3, docs/GAMIFICATION.md G10-G14) ---
LEAGUE_TIERS = ("Pamphlet", "Paperback", "Hardcover", "Folio", "First Edition", "Illuminated")  # G10, lowest first
LEAGUE_OUTCOMES = ("promoted", "stayed", "demoted")  # league_members.outcome (033 checks the same values)
LEAGUE_GROUP_SIZE = 30  # G12: groups of about this many readers of one tier
LEAGUE_PROMOTE = 7  # G13: the top this many of a full group move up (scaled by n / 30 in a smaller one)
LEAGUE_DEMOTE = 5  # G13: the bottom this many move down (scaled likewise)
LEAGUE_DEMOTE_MIN_GROUP = 10  # G13 (C24.3): a group smaller than this demotes nobody
LEAGUE_ACTIVE_DAYS = 14  # G12 (C24.3): readers with XP in this many days before a week are grouped for it
CRON_SECRET_MIN_LENGTH = 32  # C24.4: /internal endpoints refuse to run (503) under a shorter CRON_SECRET
DAILY_GOAL_SET_MIN_XP = 20  # C24.5: the goal a reader may set in settings (the database allows 10-500, G5)
DAILY_GOAL_SET_MAX_XP = 200
