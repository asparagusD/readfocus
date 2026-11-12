"""Tests for the pure helpers in scripts/bench.py. No server, no network."""

import pytest

from scripts import bench


def test_percentile_interpolates_between_samples():
    samples = [10.0, 20.0, 30.0, 40.0]
    assert bench.percentile(samples, 50) == 25.0
    assert bench.percentile(samples, 95) == pytest.approx(38.5)
    assert bench.percentile([7.0], 95) == 7.0
    assert bench.percentile([3.0, 1.0, 2.0], 50) == 2.0


def test_row_reports_p50_p95_and_run_count():
    step = bench.Step("GET /health", samples=[0.010, 0.020, 0.030])
    assert bench.row(step) == "| `GET /health` | 3 | 20 ms | 29 ms | |"


def test_row_says_not_measurable_instead_of_inventing_numbers():
    step = bench.Step("POST /sessions/start", samples=[], note="HTTP 500: planner failed")
    assert bench.row(step) == "| `POST /sessions/start` | 0 | not measurable | not measurable | HTTP 500: planner failed |"


def test_long_durations_are_shown_in_seconds():
    assert bench.fmt(0.0004) == "0.4 ms"
    assert bench.fmt(0.25) == "250 ms"
    assert bench.fmt(12.345) == "12.35 s"


def test_update_baseline_replaces_only_the_marked_section():
    doc = f"# Title\n\nkeep\n\n{bench.START}\nold\n{bench.END}\n\ntail\n"
    out = bench.update_baseline(doc, "new table")
    assert out == f"# Title\n\nkeep\n\n{bench.START}\nnew table\n{bench.END}\n\ntail\n"


def test_update_baseline_appends_when_the_section_is_missing():
    out = bench.update_baseline("# Title\n", "new table")
    assert out == f"# Title\n\n## Baseline\n\n{bench.START}\nnew table\n{bench.END}\n"


def test_update_baseline_uses_the_named_markers():
    doc = "# Title\n\n<!-- bench:baseline:start -->\nold\n<!-- bench:baseline:end -->\n"
    out = bench.update_baseline(doc, "c9 table", "c9-before")
    assert out == doc + "\n## C9-before\n\n<!-- bench:c9-before:start -->\nc9 table\n<!-- bench:c9-before:end -->\n"
    assert bench.update_baseline(out, "new", "c9-before").count("new") == 1
    assert "old" in bench.update_baseline(out, "new", "c9-before")


def test_done_at_waits_for_a_quiet_window():
    assert bench.done_at([], 30, 100) is None
    assert bench.done_at([1.0, 12.0], 30, 41.9) is None
    assert bench.done_at([1.0, 12.0], 30, 42.0) == 12.0


def test_parse_mem_reads_docker_stats_units():
    assert bench.parse_mem("215.5MiB") == 215.5
    assert bench.parse_mem("1.5GiB") == 1536.0
    assert bench.parse_mem("512KiB") == 0.5
    assert bench.parse_mem("") is None


def test_measure_ingest_stamps_each_reading_when_it_arrives(monkeypatch, tmp_path):
    """Regression (DEBUG_LOG C9.5): the status and the counts were both stamped with the time at the
    top of the poll iteration, so a book that turned ready between the two reads looked ready a whole
    iteration after its questions."""
    clock = [0.0]
    monkeypatch.setattr(bench.time, "perf_counter", lambda: clock[0])
    monkeypatch.setattr(bench.time, "sleep", lambda seconds: clock.__setitem__(0, clock[0] + seconds))
    statuses = iter(["processing", "ready", "ready"])

    class Resp:
        status_code = 200

        def __init__(self, body):
            self.body = body

        def json(self):
            return self.body

    class Client:
        def post(self, *args, **kwargs):
            return Resp({"book_id": "b1"})

        def get(self, path):
            clock[0] += 0.7  # the status call
            return Resp({"status": next(statuses), "total_chunks": 2})

        def delete(self, path):
            pass

    def counts(env, token, book_id):
        clock[0] += 1.1  # the four counts; the book turned ready while they ran
        return (2, 2, 1, 5)

    monkeypatch.setattr(bench, "ingest_state", counts)
    monkeypatch.setattr(bench, "server_rss", lambda port: 100.0)
    book = tmp_path / "b.epub"
    book.write_bytes(b"x")
    steps = [bench.Step(name) for name in ("upload", "ready", "first questions", "done")]
    args = type("Args", (), {"base_url": "http://127.0.0.1:8000", "ingest_timeout": 60, "poll": 1.0, "quiet": 0,
                             "docker": "", "keep": True})()
    bench.measure_ingest(Client(), {}, "token", book, steps, args)
    _, ready, first_q, done = steps
    assert first_q.samples == [pytest.approx(1.8)]  # when the first counts arrived
    assert ready.samples == [pytest.approx(3.5)]  # when the status that said ready arrived
    assert done.samples == [pytest.approx(1.8)]
