"""Steve's numbers (docs/STEVE.md S6): timeouts, the breaker's cool-down, the cache and the default daily limit.

Google's free-tier quotas are not hardcoded here: they are read from Google's docs and recorded with
the date in docs/STEVE.md S10.
"""

TIMEOUT_SECONDS = 30.0          # one non-streamed answer, end to end (also the SDK's HTTP timeout)
STREAM_TIMEOUT_SECONDS = 60.0   # a whole streamed answer, first piece to last
BREAKER_COOLDOWN_MINUTES = 10   # after a 429, no call on that key for this long (or Google's retryDelay, if longer)
BREAKER_MAX_MINUTES = 24 * 60   # a retryDelay longer than a day is capped here
CACHE_TTL_SECONDS = 7 * 24 * 3600
CACHE_MAX_ENTRIES = 500         # answers kept in process memory; the oldest goes first
DAILY_LIMIT_DEFAULT = 15        # questions a reader may ask on our key per local day, if the env does not say
UTC_OFFSET_LIMIT_MINUTES = 14 * 60  # real offsets run from UTC-12 to UTC+14

# --- Context (C20.4, docs/STEVE.md S4) ---------------------------------------------------------------------
# Tokens are estimated, never counted by Google: max(characters / 3, UTF-8 bytes / 4), rounded up, which is more
# than English prose really costs (about 4 characters a token), so the real request is smaller than the budget.
CHARS_PER_TOKEN = 3
BYTES_PER_TOKEN = 4
CONTEXT_MAX_TOKENS = 12_000   # hard cap on one request: context, image and question together
CARD_MAX_TOKENS = 600         # title, author and as much of the contents as fits
SESSION_MAX_TOKENS = 4_500    # the session's text, from its start to the reader's place
ANCHOR_WINDOW_TOKENS = 600    # kept around the anchor when the session is trimmed to its most recent part
HIGHLIGHT_MAX_TOKENS = 1_000  # the selection and its paragraph
REGION_MAX_TOKENS = 1_500     # an equation's source, a code listing, a figure's caption
QUESTION_MAX_CHARS = 1_200
RETRIEVE_K = 6                # passages from anywhere in the book (the hybrid retriever)
RETRIEVE_CANDIDATES = 12      # asked of the retriever, before removing what the session and highlight hold
PASSAGE_MAX_TOKENS = 450      # one retrieved passage
IMAGE_TOKENS = 1_300          # what an image is assumed to cost (a few of Gemini's 258-token tiles)
IMAGE_MAX_BYTES = 1_500_000
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
