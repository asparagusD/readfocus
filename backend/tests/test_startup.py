"""Starting the app must not start any other process."""

import gc
import subprocess

from fastapi.testclient import TestClient

from backend.main import app


def test_startup_spawns_no_subprocess(monkeypatch):
    spawned = []

    def record(*args, **kwargs):
        spawned.append(args[0] if args else kwargs.get("args"))
        raise AssertionError(f"the app tried to start a process: {spawned[-1]}")

    monkeypatch.setattr(subprocess, "Popen", record)

    # Entering the context manager runs the app's startup and shutdown.
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
    assert spawned == []


def test_startup_freezes_the_loaded_heap():
    """C33.G: a gc.collect() in a job thread must not walk, GIL held, every module the app loaded."""
    gc.unfreeze()
    try:
        with TestClient(app):
            assert gc.get_freeze_count() > 0
    finally:
        gc.unfreeze()
