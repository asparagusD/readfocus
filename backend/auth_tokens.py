"""Supabase access tokens checked here, without a round trip to Supabase Auth (C34.4, issue 13).

Every authenticated request used to call supabase.auth.get_user(token) before the endpoint ran: one more
Render-to-Supabase round trip on each of them. The project signs its access tokens with ES256 and
publishes the public keys at /auth/v1/.well-known/jwks.json, so a token can be checked here: its
signature against the key its `kid` names, audience `authenticated`, the project's issuer, expiry,
and a `sub`. The keys are read once and cached; an unknown `kid` (a rotated key) reads them again, at
most once a minute.

user_id(token) returns the user id, raises jwt.InvalidTokenError for a token that fails a check (the
caller answers 401, as Supabase would), and raises Unverifiable when it cannot decide here: not a
JWT, another algorithm, a key it cannot find or the key set out of reach. The caller then asks
Supabase as before.

Trade-off: a token stays valid here until it expires (one hour by default) after a sign-out, where
get_user would refuse it at once.
"""

import os
import threading
import time
from collections.abc import Callable

import httpx
import jwt

ALGORITHMS = ["ES256"]
AUDIENCE = "authenticated"
KEYS_TTL_SECONDS = 600  # the key set is read again after ten minutes
MISS_RETRY_SECONDS = 60  # an unknown kid reads it again at most once a minute
LEEWAY_SECONDS = 30  # Render's and Supabase's clocks may differ by a little
FETCH_TIMEOUT_SECONDS = 5


class Unverifiable(Exception):
    """The token cannot be checked here; ask Supabase."""


def _base() -> str:
    return (os.getenv("SUPABASE_URL") or "").rstrip("/")


def issuer() -> str:
    return f"{_base()}/auth/v1"


def fetch_keys() -> dict[str, jwt.PyJWK]:
    """The project's signing keys by kid, from its JWKS (ES256 keys only)."""
    resp = httpx.get(f"{issuer()}/.well-known/jwks.json", timeout=FETCH_TIMEOUT_SECONDS)
    resp.raise_for_status()
    keys = {}
    for data in resp.json().get("keys", []):
        if data.get("kid") and data.get("alg") in ALGORITHMS:
            keys[data["kid"]] = jwt.PyJWK(data)
    return keys


class KeySet:
    """The cached keys: read when stale, and again (not too often) for a kid not in them."""

    def __init__(self, fetch: Callable[[], dict[str, jwt.PyJWK]] = fetch_keys, clock: Callable[[], float] = time.monotonic):
        self._fetch, self._clock = fetch, clock
        self._lock = threading.Lock()
        self._keys: dict[str, jwt.PyJWK] = {}
        self._read_at: float | None = None

    def _read(self) -> None:
        self._keys = self._fetch()
        self._read_at = self._clock()

    def get(self, kid: str) -> jwt.PyJWK | None:
        with self._lock:
            now = self._clock()
            stale = self._read_at is None or now - self._read_at > KEYS_TTL_SECONDS
            if stale or (kid not in self._keys and now - self._read_at > MISS_RETRY_SECONDS):
                self._read()
            return self._keys.get(kid)


KEYS = KeySet()


def user_id(token: str, keys: KeySet | None = None) -> str:
    """The token's user id when it is checked here; jwt.InvalidTokenError or Unverifiable otherwise."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.DecodeError as error:
        raise Unverifiable("not a JWT") from error
    kid = header.get("kid")
    if header.get("alg") not in ALGORITHMS or not kid:
        raise Unverifiable(f"algorithm {header.get('alg')}")
    try:
        key = (keys or KEYS).get(kid)
    except Exception as error:  # any failure to read the keys leaves the decision to Supabase
        raise Unverifiable("the key set is out of reach") from error
    if key is None:
        raise Unverifiable("an unknown key")
    claims = jwt.decode(token, key.key, algorithms=ALGORITHMS, audience=AUDIENCE, issuer=issuer(),
                        leeway=LEEWAY_SECONDS, options={"require": ["exp", "sub", "aud", "iss"]})
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise jwt.InvalidTokenError("no subject")
    return claims["sub"]
