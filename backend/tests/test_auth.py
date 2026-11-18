"""Tests for get_current_user: only a token Supabase accepts is a user."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from backend import dependencies

USER_ID = "11111111-2222-3333-4444-555555555555"
VALID_JWT = "header.payload.signature"


class FakeAuth:
    """Stands in for supabase.auth: accepts VALID_JWT and nothing else."""

    def __init__(self):
        self.seen = []

    def get_user(self, token):
        self.seen.append(token)
        if token == VALID_JWT:
            return SimpleNamespace(user=SimpleNamespace(id=USER_ID))
        raise RuntimeError("invalid JWT")


@pytest.fixture
def fake_auth(monkeypatch):
    auth = FakeAuth()
    monkeypatch.setattr(dependencies, "supabase", SimpleNamespace(auth=auth))
    return auth


def call(token):
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    return dependencies.get_current_user(creds)


def test_raw_uuid_token_is_rejected(fake_auth, monkeypatch):
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("ALLOW_DEV_AUTH", raising=False)
    with pytest.raises(HTTPException) as exc:
        call(USER_ID)
    assert exc.value.status_code == 401
    assert fake_auth.seen == [USER_ID]


def test_raw_uuid_token_is_rejected_in_development(fake_auth, monkeypatch):
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("ALLOW_DEV_AUTH", "1")
    with pytest.raises(HTTPException) as exc:
        call(USER_ID)
    assert exc.value.status_code == 401


def test_valid_jwt_returns_the_user_id(fake_auth):
    assert call(VALID_JWT) == USER_ID
    assert fake_auth.seen == [VALID_JWT]


def test_rejected_jwt_gives_401(fake_auth):
    with pytest.raises(HTTPException) as exc:
        call("not.a.validtoken")
    assert exc.value.status_code == 401


def test_empty_user_response_gives_401(monkeypatch):
    auth = SimpleNamespace(get_user=lambda token: SimpleNamespace(user=None))
    monkeypatch.setattr(dependencies, "supabase", SimpleNamespace(auth=auth))
    with pytest.raises(HTTPException) as exc:
        call(VALID_JWT)
    assert exc.value.status_code == 401


# C34.4b (issue 13): a token is checked here first; Supabase Auth only when it cannot be checked here.

@pytest.fixture
def local_keys(monkeypatch):
    from backend import auth_tokens
    from backend.tests import test_auth_tokens as signed

    monkeypatch.setenv("SUPABASE_URL", signed.BASE)
    monkeypatch.setattr(auth_tokens, "KEYS", auth_tokens.KeySet(fetch=lambda: {"key-1": signed.PUBLIC}))
    return signed


def test_a_token_checked_here_gives_its_user_without_asking_supabase(fake_auth, local_keys):
    assert call(local_keys.token()) == local_keys.USER
    assert fake_auth.seen == []


def test_a_token_that_fails_the_check_here_is_401_without_asking_supabase(fake_auth, local_keys):
    with pytest.raises(HTTPException) as exc:
        call(local_keys.token(exp=1))
    assert exc.value.status_code == 401
    assert fake_auth.seen == []


def test_a_token_that_cannot_be_checked_here_is_asked_of_supabase(fake_auth, local_keys):
    assert call(VALID_JWT) == USER_ID  # not a JWT: Supabase decides
    assert fake_auth.seen == [VALID_JWT]
