"""Phase-2 memory check (C25.2): the whole backend, a shelf book ingested, and Steve answering at the same time.

Run inside the production image at Render Free's limits, offline:

    docker run --rm --network none --memory=512m --memory-swap=512m --cpus=0.1 -v <repo>:/repo:ro -w /repo \
        -e PYTHONPATH=/repo -e SUPABASE_URL=http://127.0.0.1:9 -e SUPABASE_SERVICE_KEY=offline \
        readfocus-c25-measure python scripts/dev/measure_phase2.py --book samples/technical/sicp.pdf

1. `import backend.main` (every router, as uvicorn loads it) and the embedding model, as the server does at start.
2. The book goes through the real pipeline, book_ingestor.run_job (extraction, chunks, embeddings, questions, the
   regions job, the prose rebuild), on backend/tests/memory_db.MemoryDb, as scripts/dev/gate_g5.py does.
3. Steve answers through the real backend/steve/provider.generate and Google's SDK, streamed, with a context of
   filler text at the policy cap (CONTEXT_MAX_TOKENS x CHARS_PER_TOKEN). By default (--steve once) one request runs
   in a thread as the prose rebuild starts, the phase with the highest peak, as a reader asking while their book
   finishes; --steve loop asks again and again for the whole ingest (a stress far past Google's free-tier daily
   limit on our key); --steve none asks nothing during the ingest. Requests go to a fake Gemini
   endpoint on 127.0.0.1 (no network: nothing reaches Google and no key is used).

psutil samples this process's RSS every 0.2 s; the cgroup's own peak (memory.peak, v2) is read at the end.
"""

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "dev"))
MB = 1024 * 1024
ANSWER = "The book explains this on [p. 12]: a procedure is a pattern for the local evolution of a process. " * 6


class FakeGemini(BaseHTTPRequestHandler):
    """Answers generateContent and streamGenerateContent as Gemini's REST API does (SSE for the stream)."""

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length") or 0))
        usage = {"promptTokenCount": 11_000, "candidatesTokenCount": 150}
        piece = lambda text, last: {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]},
                                                    **({"finishReason": "STOP"} if last else {})}],
                                    **({"usageMetadata": usage} if last else {})}
        if ":streamGenerateContent" in self.path:
            words = ANSWER.split(" ")
            chunks = [" ".join(words[i:i + 20]) + " " for i in range(0, len(words), 20)]
            body = "".join(f"data: {json.dumps(piece(c, i == len(chunks) - 1))}\r\n\r\n" for i, c in enumerate(chunks))
            kind = "text/event-stream"
        else:
            body, kind = json.dumps(piece(ANSWER, True)), "application/json"
        data = body.encode()
        self.send_response(200)
        self.send_header("content-type", kind)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def cgroup_peak_mb():
    for path in ("/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory/memory.max_usage_in_bytes"):
        try:
            return round(int(Path(path).read_text().strip()) / MB, 1)
        except (OSError, ValueError):
            continue
    return None


def steve_loop(context: str, stop: threading.Event, done: list, errors: list):
    """Ask Steve, streamed, until stopped: the real provider and SDK against the fake endpoint."""
    from backend.steve import provider

    async def once():
        pieces = [p async for p in provider.generate([context, "What does the author mean here?"], stream=True,
                                                     system="Explain the passage, citing pages.")]
        assert pieces and pieces[-1].done and "procedure" in "".join(p.text for p in pieces)

    while not stop.is_set():
        try:
            asyncio.run(once())
            done.append(time.perf_counter())
        except Exception as exc:  # noqa: BLE001 - a measuring script records the failure and goes on
            errors.append(repr(exc)[:200])
            time.sleep(1)
        stop.wait(0.5)


def steve_once(context: str, done: list, errors: list):
    """One streamed Steve answer, recorded in done or errors."""
    try:
        asyncio.run(_one_question(context))
        done.append(time.perf_counter())
    except Exception as exc:  # noqa: BLE001 - a measuring script records the failure
        errors.append(repr(exc)[:200])


async def _one_question(context: str):
    from backend.steve import provider

    pieces = [p async for p in provider.generate([context, "What does the author mean here?"], stream=True,
                                                 system="Explain the passage, citing pages.")]
    assert pieces and pieces[-1].done and "procedure" in "".join(p.text for p in pieces)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--book", required=True)
    parser.add_argument("--steve", choices=("once", "loop", "none"), default="once",
                        help="one request as the prose rebuild starts (default), requests all along, or none")
    args = parser.parse_args()

    from gate_g5 import (  # the C18 harness: real pipeline on MemoryDb, phase peaks
        Sampler,
        ingest,
    )

    sampler = Sampler()
    sampler.thread.start()
    start_rss = sampler.process.memory_info().rss
    import backend.main  # noqa: F401 - every router and its imports, as uvicorn loads the app
    from backend.nlp import embedder
    from backend.steve import policy, provider

    embedder.get_model()
    idle = sampler.reset()
    print(f"python {start_rss / MB:.1f} MB; app and model loaded, idle RSS {idle / MB:.1f} MB", flush=True)

    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeGemini)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = provider.http_options
    provider.http_options = lambda: {**base(), "base_url": f"http://127.0.0.1:{server.server_port}"}
    os.environ.update(GEMINI_API_KEY="offline-fake-key", GEMINI_MODEL_CHAT="fake-model")

    book = Path(args.book)
    context_chars = policy.CONTEXT_MAX_TOKENS * policy.CHARS_PER_TOKEN
    context = ("Procedures and the processes they generate. " * (context_chars // 44 + 1))[:context_chars]

    stop, done, errors = threading.Event(), [], []
    asyncio.run(_one_warm_call(provider, context))  # the SDK imported and one call made before the ingest
    after_sdk = sampler.process.memory_info().rss
    print(f"after the SDK's first call, RSS {after_sdk / MB:.1f} MB", flush=True)
    steve = threading.Thread(target=steve_loop, args=(context, stop, done, errors), daemon=True)
    if args.steve == "loop":
        steve.start()
    elif args.steve == "once":
        from backend.services import prose_job

        rebuild = prose_job.rebuild

        def rebuild_while_steve_answers(*a, **k):
            once = threading.Thread(target=steve_once, args=(context, done, errors))
            once.start()
            try:
                return rebuild(*a, **k)
            finally:
                once.join(timeout=60)

        prose_job.rebuild = rebuild_while_steve_answers
    started = time.perf_counter()
    row = asyncio.run(ingest(book, sampler))
    stop.set()
    if steve.is_alive():
        steve.join(timeout=60)
    sampler.running = False
    result = {
        "book": book.name, "status": row["status"], "seconds": round(time.perf_counter() - started, 1),
        "rss_idle_mb": round(idle / MB, 1), "rss_after_sdk_mb": round(after_sdk / MB, 1),
        "rss_peak_mb": row["rss_peak_mb"], "rss_peak_by_phase_mb": row["rss_peak_by_phase_mb"],
        "cgroup_peak_mb": cgroup_peak_mb(), "steve_mode": args.steve, "steve_calls_during_ingest": len(done),
        "steve_errors": errors[:3],
        "steve_context_chars": len(context), "chunks": row["chunks"], "regions": row["regions"],
    }
    print(json.dumps(result), flush=True)
    return 0 if row["status"] and not errors and (done or args.steve == "none") else 1


async def _one_warm_call(provider, context):
    pieces = [p async for p in provider.generate([context, "Warm up."], stream=True)]
    assert pieces[-1].done


if __name__ == "__main__":
    raise SystemExit(main())
