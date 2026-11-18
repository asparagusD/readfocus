"""C34.4 (issue 13): access tokens checked here against the project's signing keys.

Tokens are signed in the test with throwaway ES256 keys; the key set is a fake. No network.
"""

import time
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from backend import auth_tokens

BASE = "https://project.supabase.test"
USER = "11111111-2222-3333-4444-555555555555"


def make_key(kid):
    private = ec.generate_private_key(ec.SECP256R1())
    public = jwt.algorithms.ECAlgorithm.to_jwk(private.public_key(), as_dict=True)
    return private, jwt.PyJWK({**public, "kid": kid, "alg": "ES256", "use": "sig"})


SIGNER, PUBLIC = make_key("key-1")
OTHER_SIGNER, _ = make_key("key-1")  # same kid, different key: a forgery


def token(signer=SIGNER, kid="key-1", alg="ES256", **claims):
    now = int(time.time())
    body = {"iss": f"{BASE}/auth/v1", "aud": "authenticated", "sub": USER, "role": "authenticated",
            "iat": now, "exp": now + 3600, **claims}
    body = {k: v for k, v in body.items() if v is not None}
    return jwt.encode(body, signer, algorithm=alg, headers={"kid": kid})


class FakeKeys:
    """A key set source: counts reads; `keys` can change between them (a rotation) or be an error."""

    def __init__(self, keys):
        self.keys, self.reads = keys, 0

    def __call__(self):
        self.reads += 1
        if isinstance(self.keys, Exception):
            raise self.keys
        return dict(self.keys)


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture(autouse=True)
def project(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", BASE)


@pytest.fixture
def keys():
    fetch, clock = FakeKeys({"key-1": PUBLIC}), Clock()
    return SimpleNamespace(fetch=fetch, clock=clock, set=auth_tokens.KeySet(fetch=fetch, clock=clock))


def test_a_valid_token_gives_its_user_and_the_keys_are_read_once(keys):
    assert auth_tokens.user_id(token(), keys.set) == USER
    assert auth_tokens.user_id(token(), keys.set) == USER
    assert keys.fetch.reads == 1


@pytest.mark.parametrize("claims", [
    {"exp": int(time.time()) - 120},  # expired (past the 30 s leeway)
    {"aud": "anon"},  # not a signed-in user's token
    {"iss": "https://other.supabase.test/auth/v1"},  # another project
    {"sub": None},  # no user
    {"sub": ""},
])
def test_a_token_that_fails_a_check_is_invalid(keys, claims):
    with pytest.raises(jwt.InvalidTokenError):
        auth_tokens.user_id(token(**claims), keys.set)


def test_a_forged_signature_under_a_known_kid_is_invalid(keys):
    with pytest.raises(jwt.InvalidTokenError):
        auth_tokens.user_id(token(signer=OTHER_SIGNER), keys.set)


@pytest.mark.parametrize("tok", ["header.payload.signature", "not-a-jwt",
                                 jwt.encode({"sub": USER}, "a-shared-secret-of-thirty-two-bytes!", algorithm="HS256")])
def test_a_token_that_cannot_be_checked_here_is_unverifiable(keys, tok):
    with pytest.raises(auth_tokens.Unverifiable):
        auth_tokens.user_id(tok, keys.set)
    assert keys.fetch.reads == 0  # decided before any key is needed


def test_an_unknown_kid_reads_the_keys_again_but_not_on_every_request(keys):
    assert auth_tokens.user_id(token(), keys.set) == USER  # the keys are read
    rotated = token(kid="key-2")
    keys.clock.now += 120
    with pytest.raises(auth_tokens.Unverifiable):  # key-2 is not published yet
        auth_tokens.user_id(rotated, keys.set)
    assert keys.fetch.reads == 2
    with pytest.raises(auth_tokens.Unverifiable):
        auth_tokens.user_id(rotated, keys.set)
    assert keys.fetch.reads == 2  # read again at most once a minute
    signer2, public2 = make_key("key-2")
    keys.fetch.keys = {"key-1": PUBLIC, "key-2": public2}  # Supabase rotates its key
    keys.clock.now += 61
    assert auth_tokens.user_id(token(signer=signer2, kid="key-2"), keys.set) == USER
    assert keys.fetch.reads == 3


@pytest.mark.parametrize("failure", [httpx.ConnectError("no route"), RuntimeError("bad JWKS"), KeyError("keys")])
def test_keys_out_of_reach_make_a_token_unverifiable(keys, failure):
    keys.fetch.keys = failure
    with pytest.raises(auth_tokens.Unverifiable):
        auth_tokens.user_id(token(), keys.set)


def test_the_key_set_is_read_from_the_projects_jwks(monkeypatch):
    seen = []

    def get(url, timeout):
        seen.append(url)
        data = {"keys": [{**PUBLIC._jwk_data}, {"kid": "old", "alg": "HS256", "kty": "oct", "k": "c2VjcmV0"}]}
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: data)

    monkeypatch.setattr(auth_tokens.httpx, "get", get)
    keys = auth_tokens.fetch_keys()
    assert seen == [f"{BASE}/auth/v1/.well-known/jwks.json"]
    assert list(keys) == ["key-1"]  # ES256 keys only
