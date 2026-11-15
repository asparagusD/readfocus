"""Display names on leaderboards (C24.5, docs/GAMIFICATION.md G3). Pure and local: no service is asked.

clean_name(raw) returns the name to store (spaces trimmed and collapsed) or raises ValueError with a reason. A name
is 1 to DISPLAY_NAME_MAX characters of letters, marks, numbers, spaces, punctuation and symbols such as emoji; no
control characters, no link or email address, nothing posing as staff or as Steve, and no profanity. Profanity is
checked per word after undoing common disguises (digits for letters, "ph" for "f", letters spelled apart), so
"Scunthorpe" and "Assassin" pass: a few strong roots match at the start of a word, short ambiguous words only
whole. The lists are ROT13-encoded to keep the source readable."""

import codecs
import re
import unicodedata

from backend.agents import policy

_ROOTS = codecs.decode("shpx fuvg phag ovgpu avtt snttbg jubez fyhg onfgneq zbgureshpx", "rot13").split()
_WHOLE = codecs.decode("nff nffubyr pbpx cvff gjng cevpx jnaxre graq sht", "rot13").split()
_RESERVED = ("admin", "administrator", "moderator", "mod", "staff", "support", "system", "official", "steve",
             "readfocus")
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})
_LINK = re.compile(r"@|://|\bwww\.|\w\.(com|net|org|io|co|app|dev|xyz|me|info|ly|gg|tv|ru|uk|de|in)\b",
                   re.IGNORECASE)
_ALLOWED = {"shitake", "shiitake"}  # words that start with a root but are not profanity


def _words(name: str) -> list[str]:
    """Lower-case words with disguises undone; a run of single letters ("f u c k") is joined into one word."""
    raw = [w.translate(_LEET) for w in re.split(r"[\s\-_.'’,]+", name.lower()) if w]
    raw = [re.sub(r"[^\w]", "", w).replace("ph", "f") for w in raw]
    words, run = [], ""
    for word in raw + [""]:
        if len(word) == 1:
            run += word
            continue
        if run:
            words.append(run)
            run = ""
        if word:
            words.append(word)
    return words


def clean_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not 1 <= len(name) <= policy.DISPLAY_NAME_MAX:
        raise ValueError(f"A display name is 1 to {policy.DISPLAY_NAME_MAX} characters.")
    if any(unicodedata.category(ch).startswith("C") for ch in name):
        raise ValueError("A display name cannot hold control characters.")
    if _LINK.search(name):
        raise ValueError("A display name cannot be a link or an email address.")
    words = _words(name)
    if any(w in _RESERVED for w in words) or "readfocus" in "".join(words):
        raise ValueError("That name is reserved.")
    if any(w.startswith(r) and w not in _ALLOWED for w in words for r in _ROOTS) or any(w in _WHOLE for w in words):
        raise ValueError("Please choose another name.")
    return name
