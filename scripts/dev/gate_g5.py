"""Gate G5 (C18.G): ingest every book on the technical shelf offline and look for garbled text.

Each shelf book goes through the real pipeline, book_ingestor.run_job:
extraction, chunks, embeddings with the local model, questions, then the
regions job and the prose rebuild (which questions changed chunks again).
The database is backend/tests/memory_db.MemoryDb and the cover lookup is
skipped, so nothing leaves this machine and the Supabase project is never
touched. A thread samples this process's RSS every 0.2 s.

Then every item the agents can read is passed through is_garbled: each
sentence of each chunk's prose (placeholders masked), and each question's
prompt, answer, evidence and options. Chunk content (the original text,
kept verbatim for the reader) is scanned too and reported apart.

    python scripts/dev/gate_g5.py [--shelf samples/technical] [--out report.json] [--book sicp.pdf]
"""

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
MB = 1024 * 1024


class Sampler:
    def __init__(self):
        self.process, self.peak, self.running = psutil.Process(os.getpid()), 0, True
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while self.running:
            self.peak = max(self.peak, self.process.memory_info().rss)
            time.sleep(0.2)

    def reset(self):
        self.peak = self.process.memory_info().rss
        return self.peak


def flagged(items):
    from backend.regions.garble import is_garbled

    return [item for item in items if item and is_garbled(item)]


def scan(db) -> dict:
    from backend.regions import prose

    sentences, raw = [], []
    for chunk in db.tables.get("chunks", []):
        text = chunk.get("prose") or chunk["content"]
        sentences += [s for s in prose.SENTENCE_END.split(prose.mask(text)) if prose.MASK not in s]
        raw += prose.SENTENCE_END.split(chunk["content"])
    questions = db.tables.get("question_bank", [])
    fields = {"prompt": [], "answer": [], "evidence": [], "options": []}
    for q in questions:
        fields["prompt"].append(q.get("prompt"))
        fields["answer"].append(q.get("answer"))
        fields["evidence"] += (q.get("evidence") or "").split("\n\n")
        fields["options"] += [str(d) for d in q.get("distractors") or []]
    out = {"prose_sentences": len(sentences), "prose_garbled": flagged(sentences),
           "content_sentences": len(raw), "content_garbled": len(flagged(raw)), "questions": len(questions)}
    for name, items in fields.items():
        out[f"{name}_garbled"] = flagged(items)
    out["placeholder_in_questions"] = sum(
        bool(prose.PLACEHOLDER.search(" ".join(str(q.get(k) or "") for k in ("prompt", "answer", "evidence"))))
        for q in questions)
    return out


async def ingest(path: Path, sampler: Sampler) -> dict:
    from backend.agents.question_generation import agent as question_agent
    from backend.services import (
        book_ingestor,
        concept_store,
        processing_jobs,
        prose_job,
        region_job,
    )
    from backend.tests.memory_db import MemoryDb

    db = MemoryDb()
    for module in (book_ingestor, region_job, prose_job, processing_jobs, question_agent, concept_store):
        module.supabase = db
    book_ingestor.look_up_cover = lambda book, data: None  # no network
    kind = path.suffix.lstrip(".")
    book = {"id": path.stem, "user_id": "gate", "file_type": kind, "storage_path": f"gate/{path.name}",
            "status": "processing", "title": path.stem, "author": None, "cover_source": None}
    db.tables["books"] = [book]
    data = path.read_bytes()
    db.files[book["storage_path"]] = data
    job = processing_jobs.claim(processing_jobs.create(book["id"], "gate"))
    phases = {}  # peak RSS per phase: ingest (to the regions job), regions (to the prose rebuild), prose
    run_regions, run_prose = region_job.run_job, prose_job.after_regions

    async def regions_phase(job, file_bytes=None):
        phases["ingest"] = round(sampler.peak / MB, 1)
        sampler.reset()
        return await run_regions(job, file_bytes)

    async def prose_phase(book, file_bytes):
        phases["regions"] = round(sampler.peak / MB, 1)
        sampler.reset()
        result = await run_prose(book, file_bytes)
        phases["prose"] = round(sampler.peak / MB, 1)
        return result

    region_job.run_job, prose_job.after_regions = regions_phase, prose_phase
    before = sampler.reset()
    started = time.perf_counter()
    result = await book_ingestor.run_job(job, data)
    seconds = time.perf_counter() - started
    region_job.run_job, prose_job.after_regions = run_regions, run_prose
    regions = db.tables.get("page_regions", [])
    kinds = {}
    for r in regions:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    chunks = db.tables.get("chunks", [])
    return {"book": path.name, "status": result.get("status"), "seconds": round(seconds, 1),
            "rss_before_mb": round(before / MB, 1), "rss_peak_mb": max([round(sampler.peak / MB, 1), *phases.values()]),
            "rss_peak_by_phase_mb": phases,
            "chunks": len(chunks), "with_prose": sum(1 for c in chunks if c.get("prose")),
            "garbled_sentences_counted": sum(c.get("garbled_sentences") or 0 for c in chunks),
            "regions": kinds, "region_jobs": [j["status"] for j in db.tables.get("processing_jobs", [])],
            **scan(db)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--shelf", default=str(ROOT / "samples" / "technical"))
    parser.add_argument("--out", default=None)
    parser.add_argument("--book", action="append")
    args = parser.parse_args()
    from backend.nlp import embedder

    sampler = Sampler()
    sampler.thread.start()
    embedder.get_model()  # loaded once, as the server does at startup
    print(f"model loaded, RSS {sampler.reset() / MB:.1f} MB", flush=True)
    books = [p for p in sorted(Path(args.shelf).iterdir()) if p.suffix in (".pdf", ".epub")]
    if args.book:
        books = [p for p in books if p.name in args.book]
    report = []
    for path in books:
        row = asyncio.run(ingest(path, sampler))
        report.append(row)
        print(json.dumps({k: (len(v) if isinstance(v, list) and k.endswith("garbled") else v) for k, v in row.items()}),
              flush=True)
    sampler.running = False
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
