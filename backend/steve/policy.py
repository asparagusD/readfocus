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
