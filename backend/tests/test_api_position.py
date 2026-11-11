"""PUT /sessions/{id}/position and the position returned by /sessions/start (C12.2), on the in-memory database."""

import json

import pytest

from backend.tests.test_api_sessions import BOOK, USER, api, start_and_finish, submit  # noqa: F401 - api is a fixture

PLACE = {"chunk_index": 0, "block_id": "0.3", "char_offset": 41}


@pytest.fixture
def progress(api):  # noqa: F811 - the fixture above
    """The reading_progress row the planner creates on a first start (the planner is faked in these tests)."""
    row = {"id": "progress-1", "user_id": USER, "book_id": BOOK, "last_chunk_index": -1, "chunks_completed": 0,
           "average_score": 0, "re_read_queue": [], "pace_recommendation": {"multiplier": 1.1}}
    api.db.tables["reading_progress"] = [row]
    return row


def start(api):  # noqa: F811
    return api.client.post("/sessions/start", json={"book_id": BOOK}).json()


def put(api, session_id, place):  # noqa: F811
    return api.client.put(f"/sessions/{session_id}/position", json=place)


def test_a_saved_position_is_stored_on_the_progress_row_and_returned_by_the_next_start(api, progress):  # noqa: F811
    first = start(api)
    assert first["position"] is None
    saved = put(api, first["session_id"], PLACE)
    assert saved.status_code == 200 and saved.json() == {"position": PLACE}
    (row,) = api.db.tables["reading_progress"]
    assert row["position"] == PLACE
    assert row["pace_recommendation"] == {"multiplier": 1.1} and row["last_chunk_index"] == -1  # nothing else moves
    assert start(api)["position"] == PLACE


def test_a_later_save_replaces_the_place(api, progress):  # noqa: F811
    session_id = start(api)["session_id"]
    put(api, session_id, PLACE)
    put(api, session_id, {"chunk_index": 0, "block_id": "0.7", "char_offset": 0})
    assert api.db.tables["reading_progress"][0]["position"] == {"chunk_index": 0, "block_id": "0.7", "char_offset": 0}


@pytest.mark.parametrize("place", [
    {"chunk_index": -1, "block_id": "-1.0", "char_offset": 0},
    {"chunk_index": 0, "block_id": "0.3", "char_offset": -5},
    {"chunk_index": 0, "block_id": "1.3", "char_offset": 0},   # the block belongs to another chunk
    {"chunk_index": 0, "block_id": "intro", "char_offset": 0},
    {"chunk_index": 0, "block_id": "0.3"},
    {"chunk_index": 0, "block_id": "0.3", "char_offset": 10**7},
])
def test_a_malformed_place_is_refused_and_nothing_is_stored(api, progress, place):  # noqa: F811
    session_id = start(api)["session_id"]
    assert put(api, session_id, place).status_code == 422
    assert "position" not in api.db.tables["reading_progress"][0]


def test_a_chunk_outside_the_book_is_refused(api, progress):  # noqa: F811
    session_id = start(api)["session_id"]
    assert put(api, session_id, {"chunk_index": 99, "block_id": "99.0", "char_offset": 0}).status_code == 422
    assert "position" not in api.db.tables["reading_progress"][0]


def test_another_readers_session_is_not_found(api, progress):  # noqa: F811
    session_id = start(api)["session_id"]
    api.db.tables["sessions"][0]["user_id"] = "someone-else"
    assert put(api, session_id, PLACE).status_code == 404
    assert put(api, "no-such-session", PLACE).status_code == 404
    assert "position" not in api.db.tables["reading_progress"][0]


def test_no_progress_row_is_a_conflict_and_no_row_is_created(api):  # noqa: F811
    session_id = start(api)["session_id"]
    assert put(api, session_id, PLACE).status_code == 409
    assert api.db.tables.get("reading_progress", []) == []  # a new row would reset the planner's cursor


def test_the_submit_flow_keeps_the_saved_place(api, progress):  # noqa: F811
    session_id = start(api)["session_id"]
    put(api, session_id, PLACE)
    start_and_finish_id, _ = start_and_finish(api)
    assert submit(api, start_and_finish_id).status_code == 200
    (row,) = api.db.tables["reading_progress"]
    assert row["position"] == PLACE  # evaluator, optimizer and planner update other columns only
    assert row["pace_recommendation"] != {"multiplier": 1.1}  # the flow did write the row


def test_the_endpoint_needs_a_signed_in_reader(api, progress):  # noqa: F811
    from backend.dependencies import get_current_user
    from backend.main import app

    session_id = start(api)["session_id"]
    app.dependency_overrides.pop(get_current_user)
    try:
        assert put(api, session_id, PLACE).status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = lambda: USER
    assert json.dumps(api.db.tables["reading_progress"][0]).find("position") == -1


def test_a_failed_position_read_never_fails_the_start(api, progress):  # noqa: F811
    api.db.broken.add("reading_progress")
    started = api.client.post("/sessions/start", json={"book_id": BOOK})
    assert started.status_code == 200 and started.json()["position"] is None
