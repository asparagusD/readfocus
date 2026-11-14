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

- **Per reader:** `STEVE_DAILY_LIMIT_PER_USER` questions a day on our key,
  counted on the server in `steve_usage` (the reader's local day, so
  "back at midnight, your time" is true). Counted only when a call is
  made; refunded if Google fails. A reader's own key is not counted.
- **Global:** a daily budget for our key from policy, sized from
  Google's free-tier limits (recorded in S10 when C20.2 reads them).
- **Circuit breaker:** after a 429 from Google, no call on our key for a
  cool-down (Google's `Retry-After`, else policy), for every reader.
- **Cache:** a repeated question on the same book and context answers
  from the cache and costs no call.
- **Paused, not broken:** when the limit, the breaker or an outage stops
  a call, the panel shows "Steve is resting" with when he is back.
  Reading, tests and grading never wait on him. No fallback provider, no
  countdowns, no upsell.

## S7. Keys

- Our key: `GEMINI_API_KEY`, server environment only.
- A reader's own key (C20.3): `profiles.steve_key_cipher`, encrypted with
  a key derived from `KEY_ENCRYPTION_SECRET`; decrypted only in
  `backend/steve/` for the call; never returned (the client sees
  `steve_key_last4`), never logged, never in an error. `/auth/profile`
  strips the cipher. Own-key questions skip our quota and breaker but
  keep the context rules.

## S8. Logging

Never log a prompt or an answer. Log counts, sizes, latency, status,
model and cache hits only.

## S9. Data kept

`steve_threads` and `steve_messages` keep a reader's conversation per
book (question, answer, anchor, citations, model, token counts), readable
only by that reader, deleted with the book or the account. Only the
backend writes them.

## S10. Models and free-tier limits

Model names come from `GEMINI_MODEL_CHAT` and `GEMINI_MODEL_VISION`. On
2026-11-12 only `gemini-3.5-flash-lite` answered on the free tier
(DEBUG_LOG C16.4). C20.2 re-tests the chat models and records Google's
current limits here, with the date.

## S11. Evaluation

C20.9 sets the bars before the run: citation accuracy, "not covered"
recall, injection resistance (100 %), math that parses, latency, calls
used. Results go in `docs/BENCHMARKS.md`.
