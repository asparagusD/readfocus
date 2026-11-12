"""Measure the memory of the running backend, child processes included.

Starts `uvicorn backend.main:app` on a spare port with the current `.env`,
waits for /health, lets the process tree settle, then prints the resident
set size (RSS) of every process in the tree and the total. Makes no request
other than /health, so no LLM or embedding API is called.

Run from the repo root with the virtualenv active:

    python scripts/dev/measure_rss.py [--settle 8] [--port 8765]
"""

import argparse
import subprocess
import sys
import time
import urllib.request

import psutil

MB = 1024 * 1024


def wait_for_health(port, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as resp:
                if resp.status == 200:
                    return
        except OSError:
            time.sleep(0.25)
    raise SystemExit(f"backend did not answer /health on port {port} within {timeout} s")


def describe(proc):
    """One process as (rss in MB, short command line)."""
    with proc.oneshot():
        cmd = " ".join(proc.cmdline()[1:]) or proc.name()
        return proc.memory_info().rss / MB, cmd


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--settle", type=float, default=8.0, help="seconds to wait after /health answers")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", str(args.port), "--log-level", "warning"]
    )
    try:
        wait_for_health(args.port)
        time.sleep(args.settle)
        root = psutil.Process(server.pid)
        rows = [describe(p) for p in [root, *root.children(recursive=True)]]
    finally:
        for proc in psutil.Process(server.pid).children(recursive=True):
            proc.terminate()
        server.terminate()
        server.wait(timeout=10)

    for rss, cmd in rows:
        print(f"{rss:8.1f} MB  {cmd}")
    print(f"{sum(rss for rss, _ in rows):8.1f} MB  total, {len(rows)} processes")


if __name__ == "__main__":
    main()
