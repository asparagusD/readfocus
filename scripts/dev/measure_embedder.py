"""Measure the local embedding model: memory, load time and batch latency.

Run in a fresh process from the repo root, so nothing else is loaded:

    python scripts/dev/measure_embedder.py [--runs 5] [--batch 32] [--words 25 600]

Prints resident memory (psutil RSS) before the import, after importing
backend.nlp.embedder, after the model is loaded and after the batches; the
model load time; and the latency of one batch of short texts (about 25
words) and of one batch of chunk-sized texts (about 600 words, which the
model truncates to 512 tokens). The model must already be in
FASTEMBED_CACHE, or the load time includes the download.

To measure under Render-like limits, run the same command in a container
started with `docker run --cpus=0.1 --memory=512m` (docs/BENCHMARKS.md).
"""

import argparse
import os
import statistics
import sys
import time
from pathlib import Path

import psutil

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

MB = 1024 * 1024
WORDS = (
    "reader", "chapter", "the", "of", "memory", "attention", "and", "a", "slowly", "river",
    "window", "because", "page", "under", "light", "story", "question", "answer", "between",
    "early", "morning", "focus",
)


def make_texts(count: int, words: int) -> list[str]:
    """Deterministic, distinct texts of exactly `words` words."""
    return [
        " ".join(WORDS[(i * 7 + j * 3) % len(WORDS)] for j in range(words)) + "."
        for i in range(count)
    ]


def summarize(samples: list[float]) -> str:
    """Median and worst of the timing samples, in seconds."""
    return f"median {statistics.median(samples):.3f} s, max {max(samples):.3f} s, {len(samples)} runs"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--words", type=int, nargs="+", default=[25, 600], help="words per text")
    args = parser.parse_args()

    proc = psutil.Process(os.getpid())

    def rss() -> float:
        return proc.memory_info().rss / MB

    print(f"RSS before import      {rss():7.1f} MB")
    from backend.nlp import embedder

    print(f"cpus {os.cpu_count()}, threads {embedder.thread_count()}, texts per model call {embedder.BATCH_SIZE}")

    print(f"RSS after import       {rss():7.1f} MB")
    start = time.perf_counter()
    embedder.get_model()
    print(f"model load             {time.perf_counter() - start:7.3f} s")
    print(f"RSS after load         {rss():7.1f} MB")

    for words in args.words:
        label = "chunk" if words >= 300 else "short"
        texts = make_texts(args.batch, words)
        samples = []
        for _ in range(args.runs):
            start = time.perf_counter()
            embedder.embed(texts)
            samples.append(time.perf_counter() - start)
        print(f"{args.batch} x {words}-word ({label})  {summarize(samples)}")
        print(f"RSS after {label} batches {rss():7.1f} MB")


if __name__ == "__main__":
    main()
