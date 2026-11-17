"""C26.G: upload to first questions, and two uploads back to back, measured offline in the production image.

Run inside the image at Render Free's limits, with the repo mounted read-only (no network, nothing written to
Supabase: the real pipeline runs on backend/tests/memory_db.MemoryDb, as scripts/dev/gate_g5.py does):

    docker run --rm --network none --memory=512m --memory-swap=512m --cpus=0.1 -v <repo>:/repo:ro -w /repo \
        -e PYTHONPATH=/repo -e SUPABASE_URL=http://127.0.0.1:9 -e SUPABASE_SERVICE_KEY=offline -e EMBED_PRELOAD=0 \
        -e INGEST_SWEEP=0 readfocus-c25-measure python scripts/dev/measure_c26.py --book samples/technical/sicp.pdf

Each book is uploaded as POST /books/upload hands it on: its job claimed, then ingestion_worker.run(job, bytes)
(C26.1: one job at a time, in order). Since C26.3 a book opens as soon as its row exists, so "openable" is the
upload itself; this measures, from the moment its job is queued, when each book's first questions are stored
(books.status ready), when its whole text is chunked, embedded and questioned (ingest), and when its region map and
prose are done (all; since C27.1 each region map is its own queued job, timed as regions_done). --until stops after ingest (the region map is not run) or runs everything (all).
--no-queue starts every book's run_job at once, as uploads did before C26.1. psutil samples this process's RSS
every 0.2 s; the cgroup's own peak (memory.peak, v2) is read at the end.
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "dev"))
MB = 1024 * 1024


async def measure(paths: list[Path], until: str, queued: bool, sampler) -> dict:
    from backend.agents.question_generation import agent as question_agent
    from backend.services import (
        book_ingestor,
        concept_store,
        ingestion_worker,
        processing_jobs,
        prose_job,
        region_job,
    )
    from backend.tests.memory_db import MemoryDb

    db = MemoryDb()
    for module in (book_ingestor, region_job, prose_job, processing_jobs, question_agent, concept_store,
                   ingestion_worker):
        module.supabase = db
    book_ingestor.look_up_cover = lambda book, data: None  # no network
    times: dict[str, dict] = {}
    started = time.perf_counter()
    elapsed = lambda: round(time.perf_counter() - started, 1)

    mark_ready = book_ingestor.mark_ready

    def ready_at(book_id, *args, **kwargs):
        times[book_id].setdefault("first_questions_s", elapsed())
        return mark_ready(book_id, *args, **kwargs)

    book_ingestor.mark_ready = ready_at
    after_ingest = region_job.after_ingest

    async def ingest_done(book, file_bytes=None):
        times[book["id"]]["ingest_s"] = elapsed()
        if until == "all":
            await after_ingest(book, file_bytes)

    region_job.after_ingest = ingest_done
    run_regions = region_job.run_job

    async def regions_timed(job, file_bytes=None):  # C27.1: a region map is its own queued job
        result = await run_regions(job, file_bytes)
        times[job["book_id"]]["regions_done_s"] = elapsed()
        return result

    region_job.run_job = regions_timed
    runs = []
    for path in paths:
        book = {"id": path.stem, "user_id": "gate", "file_type": path.suffix.lstrip("."),
                "storage_path": f"gate/{path.name}", "status": "processing", "title": path.stem, "author": None,
                "cover_source": None}
        db.tables.setdefault("books", []).append(book)
        data = path.read_bytes()
        db.files[book["storage_path"]] = data
        job = processing_jobs.claim(processing_jobs.create(book["id"], "gate"))
        times[book["id"]] = {"book": path.name, "megabytes": round(len(data) / MB, 1)}

        async def one(job=job, data=data, book_id=book["id"]):
            run = ingestion_worker.run if queued else book_ingestor.run_job
            result = await run(job, data)
            times[book_id].update(status=result.get("status"), done_s=elapsed())

        runs.append(one())
    sampler.reset()
    await asyncio.gather(*runs)
    await ingestion_worker.drain()  # C27.1: the region maps queued behind the ingests
    return {"books": list(times.values()), "seconds": elapsed(),
            "chunks": len(db.tables.get("chunks", [])), "questions": len(db.tables.get("question_bank", [])),
            "regions": len(db.tables.get("page_regions", []))}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--book", action="append", required=True, help="once per book, in upload order")
    parser.add_argument("--until", choices=("ingest", "all"), default="ingest")
    parser.add_argument("--no-queue", action="store_true", help="every book's run at once, as before C26.1")
    args = parser.parse_args()

    from gate_g5 import Sampler
    from measure_phase2 import cgroup_peak_mb

    sampler = Sampler()
    sampler.thread.start()
    import backend.main  # noqa: F401 - every router and its imports, as uvicorn loads the app
    from backend.nlp import embedder

    embedder.get_model()
    idle = sampler.reset()
    print(f"app and model loaded, idle RSS {idle / MB:.1f} MB", flush=True)
    result = asyncio.run(measure([Path(p) for p in args.book], args.until, not args.no_queue, sampler))
    sampler.running = False
    result.update(until=args.until, queued=not args.no_queue, rss_idle_mb=round(idle / MB, 1),
                  rss_peak_mb=round(sampler.peak / MB, 1), cgroup_peak_mb=cgroup_peak_mb())
    print(json.dumps(result), flush=True)
    return 0 if all(b.get("status") == "ready" for b in result["books"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
