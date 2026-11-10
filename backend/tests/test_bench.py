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
