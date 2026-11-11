"""Offline setup for the backend tests.

pytest imports this file before any test module, so everything here runs
before `backend` is imported:

- the environment gets dummy values, which win over `.env` because
  `load_dotenv()` does not override variables that are already set;
- `supabase.create_client` returns one shared fake client;
- sockets may only connect to loopback addresses.

No test can reach Supabase or any other host. The app has no LLM or
embedding API client to replace (C8.8); backend/tests/test_no_paid_ai.py
keeps it that way.
"""

import os
import socket
from unittest.mock import MagicMock

import pytest

import supabase

DUMMY_ENV = {
    "SUPABASE_URL": "https://offline.invalid",
    "SUPABASE_SERVICE_KEY": "offline-service-key",
    "SUPABASE_ANON_KEY": "offline-anon-key",
    "ENV": "test",
    "INGEST_SWEEP": "0",  # no ingestion sweep on the fake database at startup
}
os.environ.update(DUMMY_ENV)

LOOPBACK = {"127.0.0.1", "::1", "localhost"}


class OfflineError(RuntimeError):
    """Raised when a test tries to use a live service."""


def _refuse(what):
    raise OfflineError(f"{what} is not available in the offline test suite")


def _reject_token(*args, **kwargs):
    _refuse("Supabase Auth")


FAKE_SUPABASE = MagicMock(name="supabase")
FAKE_SUPABASE.auth.get_user.side_effect = _reject_token

# Replace the constructors before backend/ imports them.
supabase.create_client = lambda *args, **kwargs: FAKE_SUPABASE

_real_connect = socket.socket.connect
_real_getaddrinfo = socket.getaddrinfo


def _host(address):
    return address[0] if isinstance(address, tuple) else address


def _guarded_connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6) and _host(address) not in LOOPBACK:
        _refuse(f"A connection to {_host(address)}")
    return _real_connect(self, address)


def _guarded_getaddrinfo(host, *args, **kwargs):
    if host not in LOOPBACK and host is not None:
        _refuse(f"A lookup of {host}")
    return _real_getaddrinfo(host, *args, **kwargs)


socket.socket.connect = _guarded_connect
socket.getaddrinfo = _guarded_getaddrinfo


@pytest.fixture
def fake_supabase():
    """The shared fake client, cleared of calls and canned results."""
    FAKE_SUPABASE.reset_mock(return_value=True)
    FAKE_SUPABASE.auth.get_user.side_effect = _reject_token
    return FAKE_SUPABASE
