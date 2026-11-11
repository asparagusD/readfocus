"""Time the main API calls against a locally running backend.

Signs in as dev test user A (credentials from .env.test, never printed),
then measures:

- cheap reads, `--runs` times each: GET /health, GET /books, GET /dashboard;
- the reading flow, `--flow-runs` times: upload sample.pdf, poll
  /books/{id}/status until ready, POST /sessions/start, finish-reading,
  submit-answers. Each flow's book is deleted afterwards unless --keep.

Since C8.8 the flow calls no LLM or embedding API. A step that does not
return 200 is reported as "not measurable" with the reason; no number is
made up.

Run from the repo root with the virtualenv active and the backend up
(`make dev-backend`):

    python scripts/bench.py [--runs 20] [--flow-runs 3] [--write]

--write replaces the marked Baseline section in docs/BENCHMARKS.md.

Ingestion (C9.0): `--ingest BOOK [BOOK ...]` uploads each book `--flow-runs`
times and times upload -> ready, upload -> chunk 0 has questions, and
upload -> done. Before C9 there is no done signal, so "done" is the last
change to the book's chunk, embedding and question counts (read through
Supabase REST as the user), once every chunk is stored and embedded and the
counts have not moved for `--quiet` seconds. Peak RSS is sampled from the
local process listening on the port. `--cold` starts the server with
`--server-cmd` before each run (and `--stop-cmd` after it), so every run
pays for the first model load:

    python scripts/bench.py --ingest sample.pdf --flow-runs 3 [--cold] [--write c9-before]
"""

import argparse
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import psutil
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "BENCHMARKS.md"
START = "<!-- bench:baseline:start -->"
END = "<!-- bench:baseline:end -->"
ANSWER = "I do not remember this part of the passage."
FALLBACK = "LLM path not measurable: the LLM call failed, so this is the time of the app's fallback"


@dataclass
class Step:
    name: str
    samples: list = field(default_factory=list)
    note: str = ""


def percentile(samples, q):
    """The q-th percentile (0-100), interpolating between sorted samples."""
    ordered = sorted(samples)
    rank = (len(ordered) - 1) * q / 100
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def fmt(seconds):
    if seconds < 0.001:
        return f"{seconds * 1000:.1f} ms"
    if seconds < 1:
        return f"{seconds * 1000:.0f} ms"
    return f"{seconds:.2f} s"


def row(step):
    if not step.samples:
        return f"| `{step.name}` | 0 | not measurable | not measurable | {step.note} |"
    p50, p95 = fmt(percentile(step.samples, 50)), fmt(percentile(step.samples, 95))
    return f"| `{step.name}` | {len(step.samples)} | {p50} | {p95} | {step.note} |".replace("|  |", "| |")


def table(steps):
    head = "| Step | Runs | p50 | p95 | Notes |\n|---|---|---|---|---|\n"
    return head + "\n".join(row(s) for s in steps)


def update_baseline(doc, body, name="baseline"):
    """Replace the block between the `bench:<name>` markers, or append it under a new heading."""
    start, end = f"<!-- bench:{name}:start -->", f"<!-- bench:{name}:end -->"
    block = f"{start}\n{body}\n{end}"
    if start in doc and end in doc:
        return doc.split(start)[0] + block + doc.split(end, 1)[1]
    return f"{doc.rstrip()}\n\n## {name.capitalize()}\n\n{block}\n"


def sign_in(env, creds):
    resp = httpx.post(
        f"{env['SUPABASE_URL']}/auth/v1/token?grant_type=password",
        headers={"apikey": env["SUPABASE_ANON_KEY"]},
        json={"email": creds["TEST_USER_A_EMAIL"], "password": creds["TEST_USER_A_PASSWORD"]},
        timeout=30,
    )
    if resp.status_code != 200:
        raise SystemExit(f"sign-in failed: HTTP {resp.status_code}")
    return resp.json()["access_token"]


def timed(step, call):
    """Run one request; record its time if it returned 200. Returns the JSON or None."""
    began = time.perf_counter()
    try:
        resp = call()
    except httpx.HTTPError as exc:
        step.note = f"{type(exc).__name__}"
        return None
    elapsed = time.perf_counter() - began
    if resp.status_code != 200:
        step.note = f"HTTP {resp.status_code}: {resp.text[:80]}"
        return None
    step.samples.append(elapsed)
    return resp.json()


def wait_until_ready(client, step, book_id, timeout=300):
    began = time.perf_counter()
    while time.perf_counter() - began < timeout:
        status = client.get(f"/books/{book_id}/status").json().get("status")
        if status == "ready":
            step.samples.append(time.perf_counter() - began)
            return True
        if status == "error":
            step.note = "ingestion ended with status error"
            return False
        time.sleep(0.5)
    step.note = f"not ready after {timeout} s"
    return False


def run_flow(client, steps, pdf, keep):
    upload, ready, start, finish, submit = steps
    files = {"file": ("sample.pdf", pdf, "application/pdf")}
    book = timed(upload, lambda: client.post("/books/upload", files=files, data={"title": "bench", "author": "bench"}))
    if not book:
        return
    try:
        if not wait_until_ready(client, ready, book["book_id"]):
            return
        session = timed(start, lambda: client.post("/sessions/start", json={"book_id": book["book_id"]}))
        if not session:
            return
        sid = session["session_id"]
        test = timed(finish, lambda: client.post(f"/sessions/{sid}/finish-reading", json={"actual_duration_minutes": 1}))
        if not test:
            return
        answers = {"answers": [ANSWER] * len(test["questions"]), "time_taken_seconds": 60}
        result = timed(submit, lambda: client.post(f"/sessions/{sid}/submit-answers", json=answers))
        if result:
            pace = (result.get("pace_recommendation") or {}).get("reason", "")
            print(f"  flow: plan reason {session.get('reason', '')[:60]!r}, score "
                  f"{result.get('total_score')}/{result.get('max_score')}, pace reason {pace[:60]!r}")
            # The app hides a failed LLM call behind canned results; say so.
            if session.get("reason", "").startswith("MOCK LLM") or pace == "Fallback duration.":
                for step in (start, finish, submit):
                    step.note = FALLBACK
    finally:
        if not keep:
            time.sleep(5)  # let background ingestion finish its last inserts
            client.delete(f"/books/{book['book_id']}")


def rest_count(env, token, table, query):
    """Rows the signed-in user can see in `table` matching a PostgREST query, counted by the server."""
    resp = httpx.get(
        f"{env['SUPABASE_URL']}/rest/v1/{table}?select=id&{query}",
        headers={"apikey": env["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {token}",
                 "Prefer": "count=exact", "Range": "0-0"},
        timeout=30,
    )
    resp.raise_for_status()
    return int(resp.headers["content-range"].rsplit("/", 1)[1])


def ingest_state(env, token, book_id):
    """(chunks stored, chunks embedded, questions on chunk 0, questions in all) for one book."""
    book = f"book_id=eq.{book_id}"
    return (
        rest_count(env, token, "chunks", book),
        rest_count(env, token, "chunks", f"{book}&embedding_local=not.is.null"),
        rest_count(env, token, "question_bank", f"{book}&chunk_index=eq.0"),
        rest_count(env, token, "question_bank", book),
    )


def server_rss(port):
    """RSS in MB of the local process listening on `port` and its children, or None if not found."""
    for conn in psutil.net_connections(kind="tcp"):
        if conn.laddr and conn.laddr.port == port and conn.status == psutil.CONN_LISTEN and conn.pid:
            root = psutil.Process(conn.pid)
            return sum(p.memory_info().rss for p in [root, *root.children(recursive=True)]) / 2**20
    return None


def container_mb(name):
    """Memory of a running container in MB from `docker stats` (cgroup usage, not RSS), or None."""
    out = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", name],
                         capture_output=True, text=True, check=False).stdout.split("/")[0].strip()
    return parse_mem(out)


def parse_mem(text):
    """'215.3MiB' or '1.2GiB' as MB (MiB), or None."""
    units = {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024, "B": 1 / 2**20}
    for unit, factor in units.items():
        if text.endswith(unit):
            return float(text[: -len(unit)]) * factor
    return None


def done_at(changes, quiet, now):
    """When ingestion finished: the last change, once nothing has changed for `quiet` seconds."""
    return changes[-1] if changes and now - changes[-1] >= quiet else None


def measure_ingest(client, env, token, path, steps, args):
    """Upload one book and time ready, chunk 0's questions and the end of ingestion (no done signal before C9)."""
    upload, ready, first_q, done = steps
    files = {"file": (path.name, path.read_bytes(), "application/octet-stream")}
    book = timed(upload, lambda: client.post("/books/upload", files=files, data={"title": "bench", "author": "bench"}))
    if not book:
        return None
    began, port = time.perf_counter(), httpx.URL(args.base_url).port
    last, changes, peak, total = None, [], 0.0, None
    try:
        while time.perf_counter() - began < args.ingest_timeout:
            # Each reading is stamped when its answer arrives: one iteration takes seconds, and a
            # stamp from the top of it made ready look later than the counts read after it.
            status = client.get(f"/books/{book['book_id']}/status").json()
            seen = time.perf_counter() - began
            if status.get("status") == "error":
                done.note = "ingestion ended with status error"
                return None
            if status.get("status") == "ready" and len(ready.samples) < len(upload.samples):
                ready.samples.append(seen)
                total = status.get("total_chunks")
            state = ingest_state(env, token, book["book_id"])
            now = time.perf_counter() - began
            if state != last:
                last, changes = state, [*changes, now]
            if state[2] and len(first_q.samples) < len(upload.samples):
                first_q.samples.append(now)
            peak = max(peak, (container_mb(args.docker) if args.docker else server_rss(port)) or 0.0)
            if total is not None and state[0] == state[1] == total and done_at(changes, args.quiet, now) is not None:
                done.samples.append(changes[-1])
                print(f"  {path.name}: {total} chunks, {state[3]} questions, peak RSS {peak:.0f} MB")
                return {"chunks": total, "questions": state[3], "peak_rss_mb": round(peak, 1)}
            time.sleep(args.poll)
        done.note = f"not done after {args.ingest_timeout} s"
        return None
    finally:
        if not args.keep:
            client.delete(f"/books/{book['book_id']}")


def wait_for_health(base_url, timeout=600):
    began = time.perf_counter()
    while time.perf_counter() - began < timeout:
        try:
            if httpx.get(f"{base_url}/health", timeout=2).status_code == 200:
                return time.perf_counter() - began
        except httpx.HTTPError:
            pass
        time.sleep(0.25)
    raise SystemExit(f"backend did not answer /health within {timeout} s")


def server_command(args):
    """The command that starts a cold server: --server-cmd, or uvicorn on this interpreter and port."""
    if args.server_cmd:
        return shlex.split(args.server_cmd)
    port = str(httpx.URL(args.base_url).port or 8000)
    return [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", port, "--log-level", "warning"]


def ingest_main(args, client, env, token):
    """--ingest: per book, `--flow-runs` uploads timed to ready, chunk 0's questions and done."""
    rows, extras = [], []
    for name in args.ingest:
        path = Path(name)
        steps = [Step(f"POST /books/upload ({path.name})"), Step(f"upload -> ready ({path.name})"),
                 Step(f"upload -> chunk 0 questions ({path.name})"), Step(f"upload -> done ({path.name})")]
        for _ in range(args.flow_runs):
            if args.cold:
                server = subprocess.Popen(server_command(args))
                startup = wait_for_health(args.base_url)
                extras.append(f"{path.name}: process start -> /health {fmt(startup)}")
            try:
                result = measure_ingest(client, env, token, path, steps, args)
                if result:
                    extras.append(f"{path.name}: {result}")
            finally:
                if args.cold:
                    if args.stop_cmd:
                        subprocess.run(shlex.split(args.stop_cmd), check=False)
                    server.terminate()
                    server.wait(timeout=60)
        rows += steps
    note = "cold process per run" if args.cold else "warm process"
    return table(rows) + f"\n\n{note}; " + "; ".join(extras)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--flow-runs", type=int, default=3)
    parser.add_argument("--keep", action="store_true", help="do not delete the uploaded books")
    parser.add_argument("--write", nargs="?", const="baseline", help="update the bench:<name> block of docs/BENCHMARKS.md")
    parser.add_argument("--ingest", nargs="+", help="time ingestion of these books instead of the API flow")
    parser.add_argument("--quiet", type=float, default=30, help="seconds without change that mean ingestion is done")
    parser.add_argument("--poll", type=float, default=1.0)
    parser.add_argument("--ingest-timeout", type=float, default=3600)
    parser.add_argument("--cold", action="store_true", help="start a fresh server for every ingestion run")
    parser.add_argument("--server-cmd", default="", help="default: uvicorn on this interpreter and the --base-url port")
    parser.add_argument("--docker", default="", help="sample this container's memory instead of a local process")
    parser.add_argument("--stop-cmd", default="", help="run after each cold run, e.g. docker stop <name>")
    args = parser.parse_args()

    creds = dotenv_values(ROOT / ".env.test")
    if not creds.get("TEST_USER_A_EMAIL"):
        raise SystemExit(".env.test is missing; run scripts/dev/create_test_users.py")
    env = dotenv_values(ROOT / ".env")
    token = sign_in(env, creds)
    client = httpx.Client(base_url=args.base_url, headers={"Authorization": f"Bearer {token}"}, timeout=300)
    if args.ingest:
        body = ingest_main(args, client, env, token)
        print(body)
        if args.write:
            DOC.write_text(update_baseline(DOC.read_text(encoding="utf-8"), body, args.write), encoding="utf-8", newline="\n")
        return

    reads = [Step("GET /health"), Step("GET /books"), Step("GET /dashboard")]
    for step in reads:
        path = step.name.split()[1]
        for _ in range(args.runs):
            timed(step, lambda path=path: client.get(path))
    flow = [
        Step("POST /books/upload", note="sample.pdf, 3.6 MB"),
        Step("upload -> status ready", note="polled every 0.5 s; ready after 5 chunks are embedded"),
        Step("POST /sessions/start", note="planner"),
        Step("POST /sessions/{id}/finish-reading", note="called right after start, so questions are generated in the request"),
        Step("POST /sessions/{id}/submit-answers", note="5 grades, then the optimizer"),
    ]
    pdf = (ROOT / "sample.pdf").read_bytes()
    for _ in range(args.flow_runs):
        run_flow(client, flow, pdf, args.keep)

    body = table(reads[:2] + flow + reads[2:])
    print(body)
    if args.write:
        DOC.write_text(update_baseline(DOC.read_text(encoding="utf-8"), body), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
