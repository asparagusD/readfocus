"""C36.6 (issue 27): upload to a quiz on the page a reader is on, measured offline in the production image.

Run inside the image at Render Free's limits, with the repo mounted read-only (no network, nothing written to
Supabase: the real pipeline runs on backend/tests/memory_db.MemoryDb, as measure_c26.py does):

    docker run --rm --network none --memory=512m --memory-swap=512m --cpus=0.1 -v <repo>:/repo:ro -w /repo \
        -e PYTHONPATH=/repo -e SUPABASE_URL=http://127.0.0.1:9 -e SUPABASE_SERVICE_KEY=offline -e EMBED_PRELOAD=0 \
        -e INGEST_SWEEP=0 readfocus-c25-measure python scripts/dev/measure_c36.py \
        --book samples/technical/interactive-linear-algebra.pdf --page 200

The book's job is run as POST /books/upload hands it on (ingestion_worker.run). A reader opens the book at once
(C26.3) on --page and saves the place once a second, as the reader does (PUT /books/{id}/position: want the
chunk and the next one, then ingestion_worker.run_questions). Timed from the job's start: the book ready (first
batch stored), the page's chunk stored, the page's questions made (the chunk and the next: a quiz on that page can
be built), and the ingest done (every chunk stored and embedded, no questions). The region map is not run.
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


async def measure(path: Path, page: int) -> dict:
    from backend.agents.question_generation import agent as question_agent
    from backend.services import (
        book_ingestor,
        concept_store,
        ingestion_worker,
        processing_jobs,
        reader_questions,
        region_job,
    )
    from backend.tests.memory_db import MemoryDb

    db = MemoryDb()
    for module in (book_ingestor, processing_jobs, question_agent, concept_store, ingestion_worker, reader_questions):
        module.supabase = db
    book_ingestor.look_up_cover = lambda book, data: None  # no network
    times: dict = {"book": path.name, "page": page}
    started = time.perf_counter()

    def elapsed() -> float:
        return round(time.perf_counter() - started, 1)

    async def no_regions(book, file_bytes=None):
        return None
    region_job.after_ingest = no_regions
    book = {"id": path.stem, "user_id": "gate", "file_type": path.suffix.lstrip("."),
            "storage_path": f"gate/{path.name}", "status": "processing", "title": path.stem, "author": None,
            "cover_source": None}
    db.tables["books"] = [book]
    data = path.read_bytes()
    db.files[book["storage_path"]] = data
    job = processing_jobs.claim(processing_jobs.create(book["id"], "gate"))
    done = asyncio.Event()

    async def ingest():
        result = await ingestion_worker.run(job, data)
        times.update(status=result.get("status"), ingest_done_s=elapsed())
        done.set()

    def chunk_on_page() -> int | None:
        for chunk in db.tables.get("chunks", []):
            pages = (chunk.get("anchors") or {}).get("pages")
            if pages and pages[0] <= page <= pages[1]:
                return chunk["chunk_index"]
        return None

    tasks: set = set()

    async def reader():
        while True:
            total = int(db.tables["books"][0].get("total_chunks") or 0)
            if total and "ready_s" not in times:
                times["ready_s"] = elapsed()
            at = chunk_on_page() if total else None
            if at is not None:
                times.setdefault("page_stored_s", elapsed())
                wanted = set(reader_questions.wanted_indices(at, total))
                asked = {q["chunk_index"] for q in db.tables.get("question_bank", [])}
                if wanted <= asked:
                    times["page_questions_s"] = elapsed()
                    times["page_chunks"] = sorted(wanted)
                    return
                if reader_questions.want(book["id"], at, total):  # as the endpoint's task after its response:
                    tasks.add(asyncio.create_task(ingestion_worker.run_questions()))  # the next save does not wait
            if done.is_set() and at is None:
                return
            await asyncio.sleep(1.0)  # the reader saves its place about once a second

    await asyncio.gather(ingest(), reader())
    await asyncio.gather(*tasks)
    times.update(chunks=len(db.tables.get("chunks", [])), questions=len(db.tables.get("question_bank", [])))
    return times


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--book", required=True)
    parser.add_argument("--page", type=int, default=1, help="the page the reader opens the book on")
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
    result = asyncio.run(measure(Path(args.book), args.page))
    sampler.running = False
    result.update(rss_idle_mb=round(idle / MB, 1), rss_peak_mb=round(sampler.peak / MB, 1),
                  cgroup_peak_mb=cgroup_peak_mb())
    print(json.dumps(result), flush=True)
    return 0 if result.get("status") == "ready" and "page_questions_s" in result else 1


if __name__ == "__main__":
    raise SystemExit(main())
