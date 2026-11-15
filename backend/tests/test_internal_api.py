"""POST /internal/leagues/rollover (C24.4, docs/GAMIFICATION.md G11): the scheduled weekly rollover, guarded by
CRON_SECRET (a bearer token, compared in constant time), safe to call any number of times; and the GitHub workflow
that calls it on Mondays at 00:05 UTC."""

import hmac
import logging
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import internal
from backend.tests.test_league_store import Db, xp
from backend.xp import league_store

SECRET = "s3cret-" + "x" * 40
URL = "/internal/leagues/rollover"
WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "league-rollover.yml"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CRON_SECRET", SECRET)
    return TestClient(app)


@pytest.fixture
def db(monkeypatch):
    fake = Db()
    monkeypatch.setattr(league_store, "supabase", fake)
    return fake


def call(client, token=SECRET, scheme="Bearer"):
    headers = {} if token is None else {"Authorization": f"{scheme} {token}"}
    return client.post(URL, headers=headers)


# --- the guard ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("value", ["", "short-secret"])
def test_without_a_long_secret_configured_the_endpoint_is_unavailable(client, monkeypatch, db, value):
    monkeypatch.setenv("CRON_SECRET", value)
    response = call(client, token=value or "anything")
    assert response.status_code == 503 and db.calls == []


def test_an_unset_secret_is_unavailable_too(client, monkeypatch, db):
    monkeypatch.delenv("CRON_SECRET")
    assert call(client).status_code == 503 and db.calls == []


@pytest.mark.parametrize(("token", "scheme"), [
    (None, "Bearer"), (SECRET[:-1], "Bearer"), (SECRET + "x", "Bearer"), (SECRET.upper(), "Bearer"),
    (SECRET, "Basic"), ("", "Bearer"),
])
def test_a_missing_or_wrong_secret_is_refused_and_nothing_runs(client, db, token, scheme):
    response = call(client, token, scheme)
    assert response.status_code == 401 and db.calls == []
    assert SECRET not in response.text


def test_the_secret_is_compared_in_constant_time(client, db, monkeypatch):
    seen, original = [], hmac.compare_digest

    def compare(a, b):
        seen.append((a, b))
        return original(a, b)
    monkeypatch.setattr(internal.hmac, "compare_digest", compare)
    assert call(client, token="wrong-" + "y" * 40).status_code == 401
    assert len(seen) == 1 and all(isinstance(part, bytes) for part in seen[0])


def test_the_secret_is_never_logged(client, db, caplog):
    caplog.set_level(logging.DEBUG)
    call(client)
    call(client, token="wrong-" + "y" * 40)
    assert SECRET not in caplog.text and "wrong-" not in caplog.text


def test_no_reader_token_is_needed_or_accepted_instead(client, db):
    """A reader's sign-in token is not the cron secret: the endpoint takes no get_current_user."""
    assert call(client, token="eyJhbGciOiJIUzI1NiJ9.reader.token").status_code == 401


# --- the rollover ---------------------------------------------------------------------------------------------------

def test_a_call_runs_the_rollover_and_returns_counts_only(client, db, monkeypatch):
    xp(db, "ann", 60, datetime(2026, 11, 14, tzinfo=UTC))
    monkeypatch.setattr(league_store, "_now", lambda: datetime(2026, 11, 16, 0, 5, tzinfo=UTC))
    response = call(client)
    assert response.status_code == 200
    assert response.json() == {"closed": [], "week": "2026-11-16T00:00:00+00:00", "grouped": 1}


def test_calling_twice_is_safe(client, db, monkeypatch):
    xp(db, "ann", 60, datetime(2026, 11, 14, tzinfo=UTC))
    monkeypatch.setattr(league_store, "_now", lambda: datetime(2026, 11, 16, 0, 5, tzinfo=UTC))
    first = call(client).json()
    tables = repr(db.tables)
    second = call(client).json()
    assert first["grouped"] == 1 and second == {**first, "grouped": 0} and repr(db.tables) == tables


def test_a_failing_rollover_is_a_500_without_details(client, db, monkeypatch):
    def broken(now=None):
        raise RuntimeError("league_weeks is down: postgres://user:pw@host")
    monkeypatch.setattr(league_store, "roll_over", broken)
    response = TestClient(app, raise_server_exceptions=False).post(URL, headers={"Authorization": f"Bearer {SECRET}"})
    assert response.status_code == 500 and "postgres://" not in response.text


# --- the GitHub workflow (G11) ----------------------------------------------------------------------------------------

def test_the_workflow_runs_on_mondays_at_0005_utc_and_by_hand():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert re.search(r'^\s*- cron: "5 0 \* \* 1"\s*$', text, re.MULTILINE)
    assert re.search(r"^\s*workflow_dispatch:\s*$", text, re.MULTILINE)


def test_the_workflow_uses_repository_secrets_and_checks_out_no_code():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "${{ secrets.CRON_SECRET }}" in text and "${{ secrets.BACKEND_URL }}" in text
    assert "actions/checkout" not in text and re.search(r"^permissions: \{\}\s*$", text, re.MULTILINE)
    assert SECRET not in text and not re.search(r"Bearer [A-Za-z0-9]", text)  # no literal token


def test_the_workflow_waits_out_a_cold_start_and_fails_on_an_error():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "--fail-with-body" in text and "--retry-all-errors" in text
    retries, delay, max_time = (int(re.search(rf"--{flag} (\d+)", text).group(1))
                                for flag in ("retry", "retry-delay", "max-time"))
    assert retries * delay >= 90 and max_time >= 60  # Render Free wakes in about a minute
    assert f"{URL}" in text and "-X POST" in text and 'Authorization: Bearer $CRON_SECRET' in text
