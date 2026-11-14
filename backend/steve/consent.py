"""The consent notice a reader accepts before Steve's first answer (docs/STEVE.md S2).

The text is served by GET /steve/settings so the reader sees exactly the version they accept;
PUT /steve/settings stores that version. Change the text and the version together, and STEVE.md
with them (backend/tests/test_steve_settings.py checks the three agree); readers who accepted an
older version are asked again.
"""

CONSENT_VERSION = "2026-11-14"

# Google's terms for the free tier ("Unpaid Services"), read on 2026-11-14; effective 2026-03-23.
TERMS_URL = "https://aistudio.google.com/docs/terms"

CONSENT_TEXT = """\
Steve is a study assistant built on Google's Gemini. When you ask him something, ReadFocus \
sends Google your question and a limited part of this book: the pages of your current session, \
the passage you selected, the table of contents and a few related passages. Never the whole \
book, and never your name or email.

ReadFocus uses Gemini's free tier. Google's terms for it say that "Google uses the content you \
submit to the Services and any generated responses to provide, improve, and develop" its \
products, and that "To help with quality and improve our products, human reviewers may read, \
annotate, and process your API input and output." They also ask: "Do not submit sensitive, \
confidential, or personal information to the Unpaid Services." If you add your own Gemini key, \
your own agreement with Google for that key applies instead.

Your notes and highlights are not sent unless you ask about them. You can turn Steve off at any \
time in his settings; while he is off, nothing is sent."""
