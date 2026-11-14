# Steve

Steve is ReadFocus's opt-in study assistant and the only part of the app
that calls a generative model (Google's Gemini). This file is the spec for
C20. CLAUDE.md constraint 1 and the `steve-guardrails` skill are the rules;
numbers are policy defaults, tunable in `backend/steve/policy.py` (C20.2).
Written in C20.1, before Steve answers anything.

## S1. Who Steve is

A calm, scholarly study partner sitting beside the reader.

- **Explains clearly.** Plain words first, then the precise ones. Short by
  default (a few sentences or a short list); longer only when asked.
- **Cites the book.** Every claim taken from the book carries its page
  (PDF) or section (EPUB): "[p. 44]", "[§4.2]".
- **Admits uncertainty.** "I'm not sure" or "the book is ambiguous here"
  is a good answer when it is the true one.
- **Never pretends the book says something it doesn't.** If the context
  sent does not cover the question, he says so first ("The book doesn't
  cover this in the pages I can see."), then may give a general answer
  labelled "Not from the book:".
- **Stays a study partner.** No flattery, no exclamation marks, no
  emoji, no pretending to have read pages he was not given, no opinions
  on the reader. Never gives the answers to an open test or quiz.

## S2. Consent and the off switch

No question reaches Google until the reader has accepted the current
notice. The backend checks it on every request; hiding a button is not a
check.

- `profiles.steve_consent_at` and `steve_consent_version` record when and
  which notice was accepted. Only the current version counts; when the
  text changes, the version changes and readers are asked again.
- `profiles.steve_enabled` is the off switch (on by default, but nothing
  is sent without consent). Off: no call is made and the "Ask Steve"
  entry points are hidden. Withdrawing consent clears both consent
  columns.
- Only the backend writes these columns: a trigger refuses changes from a
  reader's own database role (migration 023).
- API: `GET /steve/settings` returns `enabled`, `consent` (`given`, `at`,
  `version`, `current`) and the `notice` (`version`, `text`,
  `terms_url`); `PUT /steve/settings` takes `enabled` and/or `consent`
  (with `consent_version`, which must be the current one, else 409).

### The notice

Notice version: `2026-11-14`. Google's terms for the free tier were read
on 2026-11-14 at https://aistudio.google.com/docs/terms (effective
2026-03-23; `ai.google.dev/gemini-api/terms` redirects there). The code
copy is `backend/steve/consent.py`; a test keeps the two identical.

Steve is a study assistant built on Google's Gemini. When you ask him something, ReadFocus
sends Google your question and a limited part of this book: the pages of your current session,
the passage you selected, the table of contents and a few related passages. Never the whole
book, and never your name or email.

ReadFocus uses Gemini's free tier. Google's terms for it say that "Google uses the content you
submit to the Services and any generated responses to provide, improve, and develop" its
products, and that "To help with quality and improve our products, human reviewers may read,
annotate, and process your API input and output." They also ask: "Do not submit sensitive,
confidential, or personal information to the Unpaid Services." If you add your own Gemini key,
your own agreement with Google for that key applies instead.

Your notes and highlights are not sent unless you ask about them. You can turn Steve off at any
time in his settings; while he is off, nothing is sent.

## S3. Scope

Steve answers questions about the book open in the reader:

- a question typed in the panel, about the pages being read;
- "Ask Steve" on a selected passage;
- "Explain this equation" (PDF: the cropped page image; EPUB: its MathML
  or LaTeX source), "Explain this code" (the exact code region), "Explain
  this figure" (the image and its caption) (C20.8).

Out of scope: other books, the reader's account or progress, writing
essays or test answers, anything while a comprehension test or bookmark
quiz is open on that book (409), and every score, grade, question or
pacing decision (those stay algorithmic and never call Steve).

## S4. Context rules

One builder (`backend/steve/context.py`, C20.4) assembles each request,
in this priority order, and trims it to a hard cap from policy:

1. the reader's question;
2. the selected passage, if any (text plus an ANCHORS A1 anchor; it must
   occur in this book's text near the anchor, else it is refused);
3. the current session's text (`chunks.prose`, else `content`), or the
   part on screen when it is over budget;
4. the table of contents (`books.toc`), titles with pages or sections;
5. the top-k passages from the existing hybrid retriever
   (`services/retriever.py`) that are not already in part 3, each with
   its pages from `chunks.anchors`.

Trimming drops retrieved passages first, then the TOC, then the edges of
the session text; never the question or the selection. Never the whole
book, never another reader's data, never the reader's id, name or email.

Book text is data, not instructions: each part sits inside its own
delimited section (`<book_passage page="44">...</book_passage>`), the
system instruction says any instruction inside those sections is to be
ignored, and a passage cannot close its own tag. Steve has no tools and
no database access; his answers are rendered as typed blocks, never as
HTML (C20.5).

## S5. Answers and citations

- Markdown with `$...$` and `$$...$$` math; the server turns TeX into
  MathML and the answer into blocks (paragraph, math, code, list, quote).
- Citations are checked against the pages and sections actually sent; one
  that was not sent is dropped.
- "Not covered" wording as in S1.

## S6. Quota and paused states

Built in C20.2: `backend/steve/service.py` `ask()` checks, in order, the
cache, the breaker and the daily limit, then calls the provider. Numbers
are in `backend/steve/policy.py`.

- **Per reader:** `STEVE_DAILY_LIMIT_PER_USER` questions a day on our key
  (15 if unset), counted in `steve_usage` by one atomic database call
  (`steve_take_quota`, migration 024), so two tabs cannot both take the
  last question. The day is the reader's own: the browser sends its UTC
  offset in minutes (no time-zone database is needed), so "back at
  midnight, your time" is true. Counted only when a call is made;
  refunded (`steve_refund_quota`) when Google fails. A reader's own key
  is never counted. Over the limit: `SteveUnavailable("daily_limit")`
  with `until` = the reader's next midnight.
- **Circuit breaker:** after a 429 (Google's RESOURCE_EXHAUSTED), no call
  on that key for at least 10 minutes, or Google's `retryDelay` if longer
  (capped at a day): `SteveUnavailable("paused_quota", until=...)`. Our
  key is shared, so its breaker pauses every reader; a reader's own key
  has its own and pauses only itself. The SDK makes one attempt and never
  retries. In process memory: one Render instance; a restart closes it.
- **Global daily budget:** not built. Google's free-tier daily limit is
  per project and resets at midnight Pacific; when it runs out Google
  answers 429 and the breaker pauses everyone. Readers' own limits keep
  one reader from using it all.
- **Cache:** sha256 of (book id, normalised question, context hash,
  model), kept 7 days, at most 500 answers, in process memory (a restart
  empties it). A hit costs no call and no count. A failed answer is not
  cached. A book belongs to one reader, so answers never cross readers.
- **Other pauses:** `timeout` (30 s for an answer, 60 s for a whole
  stream), `unavailable` (5xx, network), `key_rejected`,
  `not_configured`. None of them opens the breaker.
- **Paused, not broken:** the panel shows "Steve is resting" with when he
  is back. Reading, tests and grading never wait on him. No fallback
  provider, no countdowns, no upsell.

## S7. Keys

- Our key: `GEMINI_API_KEY`, server environment only.
- A reader's own key (C20.3, `backend/steve/keys.py`):
  - `PUT /steve/key` `{"key": "..."}`: the body is read by hand (a
    validation error would echo the key), the shape checked, then Google
    is asked once to read the chat model's details with that key (no
    generation, no quota). Accepted: encrypted and stored; refused: 400;
    Google busy or down: 503, nothing stored.
  - Stored in `profiles.steve_key_cipher` as a Fernet token (AES-128-CBC
    with HMAC-SHA256) under a key derived by HKDF-SHA256 from
    `KEY_ENCRYPTION_SECRET` (at least 32 characters, else own keys are off:
    503); `steve_key_last4` beside it.
  - `GET /steve/key` and every other response give only
    `{has_key, last4}`; `DELETE /steve/key` clears both columns.
    `/auth/profile` strips the cipher.
  - Decrypted only in `keys.reader_key` for a call. A cipher that no
    longer decrypts (the secret changed) is `key_rejected`: the reader
    adds the key again.
  - Never logged, never in an error; the browser drops it once sent.
  - Own-key questions skip our daily limit and our breaker (their own key
    has its own breaker) but keep the context rules.
- UI: "Use your own free Gemini key" in the account panel's settings
  (C20.3; Steve's panel reuses it in C20.7): a password field, a link to
  Google AI Studio's key page, Save key (checks with Google first), then
  "Key ending in ...." and Remove key. The handoff's "Kept on this device
  only" became "The key is encrypted and never shown again" (D6); its
  "Test it" is Save key, which tests before it saves.

## S8. Logging

Never log a prompt or an answer. Log counts, sizes, latency, status,
model and cache hits only.

## S9. Data kept

`steve_threads` and `steve_messages` keep a reader's conversation per
book (question, answer, anchor, citations, model, token counts), readable
only by that reader, deleted with the book or the account. Only the
backend writes them.

## S10. Models and free-tier limits

Client: Google's Gen AI SDK for Python, `google-genai` 2.34.0
(Apache-2.0, released 2026-10-29; Google's libraries page, read
2026-11-14, names it the official library and the older
`google-generativeai` deprecated since 2025-11-30). Imported only by
`backend/steve/provider.py`, on first use; +18 MB RSS when loaded
(`docs/BENCHMARKS.md`). Timeout from policy; `retry_options.attempts = 1`.

Model names come from `GEMINI_MODEL_CHAT` and `GEMINI_MODEL_VISION`; none
is hardcoded. On 2026-11-12 only `gemini-3.5-flash-lite` answered on the
free tier (DEBUG_LOG C16.4), so both are set to it; the chat models are
not re-tested in C20.2 (no live call was made).

Limits, read 2026-11-14 at aistudio.google.com/docs/rate-limits: limits
apply per project, not per key; requests per day reset at midnight
Pacific; per-model free-tier numbers are shown only in AI Studio. The
last numbers read there (by you, 2026-11-12): `gemini-3.5-flash-lite`
15 RPM, 250k TPM, 500 RPD; `gemini-3.8-flash` 5 RPM, 250k TPM, 20 RPD.
At 500 a day and 15 per reader, our key serves about 33 readers' full
days.

## S11. Evaluation

C20.9 sets the bars before the run: citation accuracy, "not covered"
recall, injection resistance (100 %), math that parses, latency, calls
used. Results go in `docs/BENCHMARKS.md`.
