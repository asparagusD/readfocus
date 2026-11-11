"""Word and phrase lookup: Free Dictionary API, then Wikipedia, behind a shared cache (C12.6).

Both are free, keyless APIs (free-intelligence skill). Every answer, "not
found" included, is kept in the shared `term_lookups` table (90 days found,
7 days not found) with a small in-process copy in front of it. A timeout or
error stops the lookup at once (no retries) and is never cached, so reading
never waits more than one slow call.
"""

import logging
import re
import threading
import unicodedata
from collections import OrderedDict, deque
from datetime import UTC, datetime, timedelta
from typing import NamedTuple
from urllib.parse import quote

import httpx

from backend.services.supabase_client import supabase

USER_AGENT = "ReadFocus/2.0 (https://github.com/asparagusD/readfocus)"
TIMEOUT_SECONDS = 2.5
DICTIONARY_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/"
WIKIPEDIA_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/"
FOUND_TTL = timedelta(days=90)
NOT_FOUND_TTL = timedelta(days=7)
MAX_WORDS, MAX_CHARS = 5, 60
MAX_BASE_FORMS = 3
MAX_MEANINGS, MAX_DEFINITIONS, MAX_SENTENCES = 3, 2, 2
MEMORY_ENTRIES = 2000
RATE_LIMIT, RATE_WINDOW_SECONDS = 60, 60
UNAVAILABLE = "We couldn't look this up right now. Please try again in a moment."

log = logging.getLogger(__name__)
_http = httpx.Client(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
_memory: OrderedDict = OrderedDict()
_calls: dict[str, deque] = {}
_lock = threading.Lock()


class Term(NamedTuple):
    key: str      # lower case
    display: str  # original casing, punctuation stripped
    words: int


class Unavailable(Exception):
    """An upstream call timed out or failed: say so, cache nothing."""


def _now() -> datetime:
    return datetime.now(UTC)


def reset() -> None:
    with _lock:
        _memory.clear()
        _calls.clear()


def normalize(raw: str) -> Term | None:
    """Trim, drop punctuation (keeping inner hyphens and apostrophes), lower-case; None if not a term."""
    text = unicodedata.normalize("NFKC", raw or "").replace("’", "'").replace("‘", "'")
    words = []
    for token in text.split():
        token = re.sub(r"[^\w'\-]", "", token).strip("'-_")
        if token:
            words.append(token)
    display = " ".join(words)
    if not words or len(words) > MAX_WORDS or len(display) > MAX_CHARS:
        return None
    if not any(ch.isalpha() for ch in display):
        return None
    return Term(display.lower(), display, len(words))


def base_forms(word: str) -> list[str]:
    """Simple base forms to retry after a dictionary miss, most likely first."""
    forms = []
    if word.endswith("ies") and len(word) > 4:
        forms.append(word[:-3] + "y")
    if word.endswith("es") and len(word) > 3:
        forms.append(word[:-2])
    if word.endswith("s") and not word.endswith("ss") and len(word) > 2:
        forms.append(word[:-1])
    for suffix in ("ed", "ing"):
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            stem = word[: -len(suffix)]
            forms += [stem, stem + "e"]
    return list(dict.fromkeys(f for f in forms if f != word))[:MAX_BASE_FORMS]


def allow(user_id: str) -> int:
    """0 when the user may look up now, else the seconds until they may (sliding window)."""
    now = _now().timestamp()
    with _lock:
        calls = _calls.setdefault(user_id, deque())
        while calls and calls[0] <= now - RATE_WINDOW_SECONDS:
            calls.popleft()
        if len(calls) >= RATE_LIMIT:
            return max(1, int(calls[0] + RATE_WINDOW_SECONDS - now) + 1)
        calls.append(now)
        return 0


def _get(url: str) -> dict | list | None:
    """The JSON at url, None on 404; raises Unavailable on a timeout, network error or other status."""
    try:
        response = _http.get(url)
    except httpx.HTTPError as error:
        raise Unavailable(str(error)) from error
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise Unavailable(f"status {response.status_code}")
    try:
        return response.json()
    except ValueError as error:
        raise Unavailable("bad JSON") from error


def _blank(term: str) -> dict:
    return {"term": term, "phonetic": None, "audio_url": None, "meanings": [], "wiki": None,
            "source": None, "found": False, "ambiguous": False, "url": None}


def _from_dictionary(term: str, entries: list) -> dict:
    out = dict(_blank(term), source="dictionary", found=True)
    phonetics = [p for e in entries for p in e.get("phonetics") or []]
    out["phonetic"] = entries[0].get("phonetic") or next((p["text"] for p in phonetics if p.get("text")), None)
    out["audio_url"] = next((p["audio"] for p in phonetics if p.get("audio")), None)
    for meaning in (m for e in entries for m in e.get("meanings") or []):
        definitions = meaning.get("definitions") or []
        out["meanings"].append({
            "part_of_speech": meaning.get("partOfSpeech"),
            "definitions": [d["definition"] for d in definitions[:MAX_DEFINITIONS] if d.get("definition")],
            "example": next((d["example"] for d in definitions if d.get("example")), None),
        })
        if len(out["meanings"]) == MAX_MEANINGS:
            break
    return out


def _from_wikipedia(term: str, page: dict) -> dict:
    url = ((page.get("content_urls") or {}).get("desktop") or {}).get("page")
    out = dict(_blank(term), source="wikipedia", found=True, url=url)
    if page.get("type") == "disambiguation":
        return dict(out, ambiguous=True)
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])", (page.get("extract") or "").strip())
    out["wiki"] = {"title": page.get("title"), "extract": " ".join(sentences[:MAX_SENTENCES]), "url": url,
                   "thumbnail_url": (page.get("thumbnail") or {}).get("source")}
    return out


def _dictionary(term: Term) -> dict | None:
    for word in [term.key, *base_forms(term.key)]:
        entries = _get(DICTIONARY_URL + quote(word, safe=""))
        if isinstance(entries, list) and entries:
            return _from_dictionary(term.key, entries)
    return None


def _wikipedia(term: Term) -> dict | None:
    title = (term.display[:1].upper() + term.display[1:]).replace(" ", "_")
    page = _get(WIKIPEDIA_URL + quote(title, safe="_'-"))
    return _from_wikipedia(term.key, page) if isinstance(page, dict) and page.get("title") else None


def _fresh(found: bool, fetched_at: datetime) -> bool:
    return _now() - fetched_at < (FOUND_TTL if found else NOT_FOUND_TTL)


def _cached(key: str, lang: str) -> dict | None:
    with _lock:
        hit = _memory.get((key, lang))
        if hit and _fresh(hit[1], hit[2]):
            _memory.move_to_end((key, lang))
            return hit[0]
    try:
        rows = supabase.table("term_lookups").select("payload, found, fetched_at").eq("term", key).eq("lang", lang).execute().data
    except Exception as error:  # noqa: BLE001 - a broken cache never blocks a lookup
        log.warning("term_lookups read failed: %s", error)
        return None
    if not rows:
        return None
    fetched_at = datetime.fromisoformat(rows[0]["fetched_at"])
    if not _fresh(rows[0]["found"], fetched_at):
        return None
    _remember(key, lang, rows[0]["payload"], rows[0]["found"], fetched_at)
    return rows[0]["payload"]


def _remember(key, lang, payload, found, fetched_at) -> None:
    with _lock:
        _memory[(key, lang)] = (payload, found, fetched_at)
        _memory.move_to_end((key, lang))
        while len(_memory) > MEMORY_ENTRIES:
            _memory.popitem(last=False)


def _store(key: str, lang: str, payload: dict) -> None:
    fetched_at = _now()
    _remember(key, lang, payload, payload["found"], fetched_at)
    kind = ("ambiguous" if payload["ambiguous"] else "summary" if payload["wiki"] else
            "definition" if payload["found"] else "none")
    try:
        supabase.table("term_lookups").upsert({
            "term": key, "lang": lang, "kind": kind, "payload": payload, "source": payload["source"],
            "found": payload["found"], "fetched_at": fetched_at.isoformat(),
        }, on_conflict="term,lang").execute()
    except Exception as error:  # noqa: BLE001 - the answer is still returned; the next reader fetches it again
        log.warning("term_lookups write failed: %s", error)


def look_up(term: Term, lang: str = "en", proper: bool = False) -> dict:
    """The compact answer for a normalised term; {unavailable: true, message} if a source failed."""
    wiki_first = proper or term.words > 1
    key = term.display if wiki_first else term.key
    cached = _cached(key, lang)
    if cached is not None:
        return cached
    try:
        if term.words > 1:
            payload = _wikipedia(term)
        elif wiki_first:
            payload = _wikipedia(term) or _dictionary(term)
        else:
            payload = _dictionary(term) or _wikipedia(term)
    except Unavailable:
        return dict(_blank(term.key), unavailable=True, message=UNAVAILABLE)
    payload = payload or _blank(term.key)
    _store(key, lang, payload)
    return payload
