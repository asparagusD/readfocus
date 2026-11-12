"""Grader agreement with the labelled answers (C15.3): measure, and search the policy constants.

    python scripts/eval_grader.py            # agreement with the current policy
    python scripts/eval_grader.py --search   # grid search + leave-one-out estimate

Offline: the local all-MiniLM-L6-v2 in .cache/fastembed, no network. The
answers are embedded once; the constants only change how decide() reads the
cosines, so every candidate re-grades from the same vectors.

Agreement: a grade within policy.GRADE_AGREEMENT_TOLERANCE of the human one.
--search tries every combination in GRID on all cases (the in-sample best),
and estimates how the search itself generalises with leave-one-out: each case
is graded with the best constants found on the other cases. A change is only
worth making if the leave-one-out agreement beats the current constants'.
"""

import argparse
import itertools
import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.agents import policy
from backend.agents.evaluation import grader
from backend.agents.evaluation.grader import GradeInput
from backend.nlp import embedder

FIXTURE = ROOT / "backend" / "tests" / "fixtures" / "answers.json"
NAMES = ("GRADE_WEIGHTS", "GRADE_COSINE_FLOOR", "GRADE_COSINE_FULL", "GRADE_RELEVANCE_FLOOR", "GRADE_RELEVANCE_FULL")
WEIGHTS = [{"cosine": c, "coverage": v, "relevance": round(1 - c - v, 2)}
           for c in (0.35, 0.45, 0.55, 0.65, 0.75) for v in (0.15, 0.25, 0.35, 0.45) if c + v <= 1.0]
GRID = {
    "GRADE_WEIGHTS": WEIGHTS,
    "GRADE_COSINE_FLOOR": [0.0, 0.1, 0.2, 0.3],
    "GRADE_COSINE_FULL": [0.65, 0.7, 0.75, 0.8, 0.85],
    "GRADE_RELEVANCE_FLOOR": [0.1, 0.15, 0.2],
    "GRADE_RELEVANCE_FULL": [0.3, 0.35, 0.45],
}


def graded(cases, inputs, constants=None):
    """Scores under `constants` (the current policy when None); decide() reads policy at call time."""
    saved = {name: getattr(policy, name) for name in NAMES}
    try:
        for name, value in (constants or {}).items():
            setattr(policy, name, value)
        return [grader.decide(data) for data in inputs]
    finally:
        for name, value in saved.items():
            setattr(policy, name, value)


def agrees(grade, case):
    return abs(grade.score - case["human_score"]) <= policy.GRADE_AGREEMENT_TOLERANCE


def summary(cases, grades, label):
    ok = [agrees(g, c) for g, c in zip(grades, cases)]
    mae = sum(abs(g.score - c["human_score"]) for g, c in zip(grades, cases)) / len(cases)
    print(f"{label}: {sum(ok)} of {len(cases)} agree ({sum(ok) / len(cases):.1%}), mean |error| {mae:.3f}")
    per = Counter(c["category"] for c in cases)
    hits = Counter(c["category"] for c, good in zip(cases, ok) if good)
    print("  per category: " + ", ".join(f"{k} {hits[k]}/{n}" for k, n in sorted(per.items())))
    high_off = [c["id"] for g, c, good in zip(grades, cases, ok) if g.confidence == "high" and not good]
    print(f"  high-confidence grades that disagree: {high_off or 'none'}")
    return sum(ok), mae


def with_cosines(cases):
    """Each case as decide() input with its cosines filled in, the way grade_all() computes them."""
    inputs = [GradeInput(**case) for case in cases]
    free = [d for d in inputs if d.answer.strip() and not grader.is_closed(d)]
    texts = list(dict.fromkeys(t for d in free for t in (d.answer, d.question, *grader._pieces(d))))
    vectors = dict(zip(texts, embedder.embed(texts)))
    out = []
    for data in inputs:
        if data in free:
            answer = vectors[data.answer]
            data = data.model_copy(update={
                "cosine": max(float(answer @ vectors[p]) for p in grader._pieces(data)),
                "question_cosine": float(answer @ vectors[data.question]),
            })
        out.append(data)
    return out


def table(cases, inputs):
    """Every combination in GRID with each case's score under it, graded once."""
    rows = []
    for combo in itertools.product(*GRID.values()):
        constants = dict(zip(GRID, combo))
        if constants["GRADE_COSINE_FLOOR"] < constants["GRADE_COSINE_FULL"]:
            rows.append((constants, [g.score for g in graded(cases, inputs, constants)]))
    return rows


def best_on(cases, rows, indices):
    """The row with the most agreements on `indices`, then the least mean error."""
    tolerance = policy.GRADE_AGREEMENT_TOLERANCE

    def key(row):
        scores = row[1]
        ok = sum(abs(scores[i] - cases[i]["human_score"]) <= tolerance for i in indices)
        return (-ok, round(sum(abs(scores[i] - cases[i]["human_score"]) for i in indices), 6))
    return min(rows, key=key)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--search", action="store_true", help="grid search with a leave-one-out estimate")
    args = parser.parse_args()
    os.environ.setdefault("FASTEMBED_CACHE", str(ROOT / ".cache" / "fastembed"))  # the local model, offline
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))
    inputs = with_cosines(cases)
    current = graded(cases, inputs)
    summary(cases, current, "current constants")
    for grade, case in zip(current, cases):
        if not agrees(grade, case):
            print(f"  off: {case['id']} ({case['category']}) human {case['human_score']} grader {grade.score:.2f}"
                  f" {grade.confidence} {grade.components}")
    if not args.search:
        return
    every = list(range(len(cases)))
    rows = table(cases, inputs)
    best, _ = best_on(cases, rows, every)
    print(f"\n{len(rows)} combinations; in-sample best: {best}")
    summary(cases, graded(cases, inputs, best), "in-sample best (fitted on these cases)")
    tolerance = policy.GRADE_AGREEMENT_TOLERANCE
    held = [abs(best_on(cases, rows, [j for j in every if j != i])[1][i] - cases[i]["human_score"]) <= tolerance
            for i in every]
    print(f"leave-one-out: {sum(held)} of {len(cases)} agree ({sum(held) / len(cases):.1%})"
          f" against {sum(agrees(g, c) for g, c in zip(current, cases))} for the current constants")

if __name__ == "__main__":
    main()
