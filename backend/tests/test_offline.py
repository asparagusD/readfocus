"""The backend suite runs with no .env, no Supabase and no network."""

import os
import socket

import pytest
from fastapi.testclient import TestClient

from backend.tests.conftest import DUMMY_ENV, OfflineError


def test_environment_is_the_dummy_one():
    for name, value in DUMMY_ENV.items():
        assert os.environ[name] == value


def test_supabase_client_is_the_fake(fake_supabase):
    from backend.services.supabase_client import supabase

    assert supabase is fake_supabase
    with pytest.raises(OfflineError):
        supabase.auth.get_user("any-token")


def test_outbound_connections_are_blocked():
    with pytest.raises(OfflineError):
        socket.create_connection(("example.com", 80), timeout=1)
    with socket.socket() as sock, pytest.raises(OfflineError):
        sock.connect(("192.0.2.1", 80))


def test_loopback_connections_still_work():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        with socket.create_connection(server.getsockname(), timeout=1) as client:
            assert client.getpeername() == server.getsockname()


def test_a_protected_endpoint_answers_401_without_supabase():
    from backend.main import app

    response = TestClient(app).get("/books", headers={"Authorization": "Bearer some.jwt.token"})
    assert response.status_code == 401
