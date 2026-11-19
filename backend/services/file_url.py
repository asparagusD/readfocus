"""One signed URL per book file, handed out again while it has a while to live (C35.8a, issue 19).

Supabase Storage serves signed URLs through its CDN, and the CDN's cache key includes the URL's token. On a miss
the CDN first fetches the whole object from Storage and answers a byte range only once that fetch has reached it
(0.3 to 2 MB/s measured on 2026-11-19). A PDF that is not linearized keeps its cross-reference table at its end,
so its first page waited for the whole file, 5 to 20 s for a 16 MB thesis, and on every open, since /open signed a
new URL each time. Handing out the same URL makes every open after the first in its life a cache hit (about 50 ms a
range). The URL lives BOOK_FILE_URL_SECONDS and is replaced once less than BOOK_FILE_URL_MIN_LEFT is left, so a
reader always gets at least that long. Kept in this process: Render runs one worker, and a restart signs anew.
"""

import threading
import time
from collections.abc import Callable
from typing import Any

from backend.agents import policy

_kept: dict[str, tuple[str, float]] = {}  # storage path -> (signed URL, monotonic time it expires)
_lock = threading.Lock()


def signed_url(bucket: Any, path: str, *, now: Callable[[], float] = time.monotonic) -> tuple[str, int]:
    """(URL, seconds it still lives) for `path` in `bucket`, the kept one while it has long enough left.

    Raises when Storage refuses to sign or answers without a URL; nothing is kept then.
    """
    at = now()
    with _lock:
        kept = _kept.get(path)
    if kept and kept[1] - at >= policy.BOOK_FILE_URL_MIN_LEFT:
        return kept[0], int(kept[1] - at)
    signed = bucket.create_signed_url(path, policy.BOOK_FILE_URL_SECONDS)
    url = signed.get("signedURL") or signed.get("signedUrl")
    if not url:
        raise RuntimeError("Storage gave no signed URL")
    with _lock:
        for stale in [key for key, (_, ends) in _kept.items() if ends - at < policy.BOOK_FILE_URL_MIN_LEFT]:
            del _kept[stale]  # a URL too old to hand out again
        _kept[path] = (url, at + policy.BOOK_FILE_URL_SECONDS)
    return url, policy.BOOK_FILE_URL_SECONDS


def forget(path: str) -> None:
    """Hand out no kept URL for `path` again (its book is being deleted)."""
    with _lock:
        _kept.pop(path, None)


def forget_all() -> None:
    """Drop every kept URL (tests)."""
    with _lock:
        _kept.clear()
