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
"""

import argparse
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
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


def update_baseline(doc, body):
    block = f"{START}\n{body}\n{END}"
    if START in doc and END in doc:
        return doc.split(START)[0] + block + doc.split(END, 1)[1]
    return f"{doc.rstrip()}\n\n## Baseline\n\n{block}\n"


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


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--flow-runs", type=int, default=3)
    parser.add_argument("--keep", action="store_true", help="do not delete the uploaded books")
    parser.add_argument("--write", action="store_true", help="update docs/BENCHMARKS.md")
    args = parser.parse_args()

    creds = dotenv_values(ROOT / ".env.test")
    if not creds.get("TEST_USER_A_EMAIL"):
        raise SystemExit(".env.test is missing; run scripts/dev/create_test_users.py")
    token = sign_in(dotenv_values(ROOT / ".env"), creds)
    client = httpx.Client(base_url=args.base_url, headers={"Authorization": f"Bearer {token}"}, timeout=300)

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
