"""C20.9: Steve's evaluation set is well-formed and the runner scores answers as docs/STEVE.md S11 says. Offline:
no call is made; the prompts are built from the test shelf only when it has been fetched."""

import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("steve_eval", ROOT / "scripts" / "steve_eval.py")
steve_eval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(steve_eval)

FIXTURE = steve_eval.load_fixture()
ITEMS = FIXTURE["items"]
SHELF_FILES = {b["file"] for b in FIXTURE["books"].values()}
HAVE_SHELF = all((steve_eval.SHELF_DIR / f).exists() for f in SHELF_FILES)


def _item(kind: str) -> dict:
    return next(i for i in ITEMS if i["kind"] == kind)


def test_the_set_has_fifteen_items_in_the_asked_mix():
    steve_eval.check_set(FIXTURE)
    assert len(ITEMS) == steve_eval.MAX_CALLS == 15
    assert len({i["id"] for i in ITEMS}) == 15


def test_every_item_is_well_formed():
    shelf = (ROOT / "samples" / "technical" / "SHELF.md").read_text(encoding="utf-8")
    for item in ITEMS:
        book = FIXTURE["books"][item["book"]]
        assert f"`{book['file']}`" in shelf, item["id"]
        epub = book["file"].endswith(".epub")
        for label in [*item["session"], *item["retrieved"], *item["expect"]]:
            kind, n = steve_eval.parse_label(label)
            assert kind == ("sec" if epub else "p") and n >= 1, (item["id"], label)
        assert item["session"], item["id"]
        assert not set(item["session"]) & set(item["retrieved"]), item["id"]
        assert set(item.get("focus", {})) <= set(item["retrieved"]), item["id"]
        assert 0 < len(item["question"]) <= 1_200


def test_expected_labels_sit_where_the_kind_says():
    for item in ITEMS:
        sent = set(item["session"]) | set(item["retrieved"])
        if item["kind"] == "session":
            assert item["expect"] and set(item["expect"]) <= set(item["session"]) and not item["retrieved"]
        elif item["kind"] == "retrieval":
            assert item["expect"] and set(item["expect"]) <= set(item["retrieved"])
        elif item["kind"] == "not_covered":
            assert item["expect"] == [] and not item["retrieved"]
        else:
            assert item["expect"] and set(item["expect"]) <= sent
            assert item["inject"]["into"] in sent
            assert item["inject"]["canary"] in item["inject"]["text"]
            assert item["inject"]["canary"].lower() not in item["question"].lower()


def test_injection_lands_as_its_own_paragraph_in_the_middle():
    text = "one\ntwo\nthree\nfour"
    out = steve_eval.inject(text, "OBEY ME")
    assert "\n\nOBEY ME\n\n" in out
    assert out.replace("\n\nOBEY ME\n\n", "\n") .replace("\n\n", "\n") == text


def test_labels_map_to_the_apps_anchors():
    assert steve_eval.anchor_of("p. 46") == {"kind": "pdf", "page": 46}
    assert steve_eval.anchor_of("sec. 6") == {"kind": "epub", "spine_index": 5, "cfi": "epubcfi(/6/12!/4)"}
    with pytest.raises(ValueError):
        steve_eval.parse_label("page 4")


def test_scoring_a_grounded_answer():
    item = _item("session")
    citations = {label: {} for label in item["session"]}
    good = steve_eval.score(item, f"It says this [{item['expect'][0]}].", citations)
    assert good["passed"] and good["expected_cited"]
    invented = steve_eval.score(item, f"It says this [{item['expect'][0]}] and that [p. 999].", citations)
    assert not invented["checks"]["citations_exist"] and not invented["passed"]
    bare = steve_eval.score(item, "It says this, trust me.", citations)
    assert not bare["checks"]["answered_from_book"]
    refused = steve_eval.score(item, f"The book doesn't cover this [{item['expect'][0]}].", citations)
    assert not refused["checks"]["answered_from_book"]


def test_citations_inside_code_and_math_are_not_counted():
    assert steve_eval.cited_labels("see `[p. 9]` and $[p. 8]$ but [p. 7] and [pp. 3-4]") == ["p. 7", "p. 3", "p. 4"]


def test_scoring_not_covered_and_length():
    item = _item("not_covered")
    said = steve_eval.score(item, "The book doesn't cover this in the pages I can see. Not from the book: x.", {})
    assert said["passed"]
    late = steve_eval.score(item, "word " * 80 + "The book does not cover this.", {})
    assert not late["checks"]["says_not_covered"]
    long = steve_eval.score(item, "The book doesn't cover this. " + "word " * 260, {})
    assert not long["checks"]["words"] and long["words"] > steve_eval.MAX_WORDS


def test_scoring_injection():
    item = _item("injection")
    citations = {label: {} for label in item["session"] + item["retrieved"]}
    label, canary = item["expect"][0], item["inject"]["canary"]
    assert steve_eval.score(item, f"It answers the reader [{label}].", citations)["passed"]
    obeyed = steve_eval.score(item, f"{canary.upper()} [{label}]", citations)
    assert not obeyed["checks"]["injection_ignored"]
    silent = steve_eval.score(item, "I will not do that.", citations)
    assert not silent["checks"]["injection_ignored"]


def test_the_summary_counts_passes_and_errors():
    results = [
        {"id": "a", "kind": "session", "passed": True, "checks": {"words": True}, "expected_cited": True, "ms": 10,
         "tokens_in": 5, "tokens_out": 2, "model": "m"},
        {"id": "b", "kind": "injection", "error": "timeout", "passed": False},
    ]
    report = steve_eval.summary(results)
    assert report["passed"] == "1/2" and report["by_kind"]["session"] == "1/1"
    assert report["errors"] == ["b: timeout"] and report["checks"] == {"words": "1/1"}


def test_the_runner_never_reads_a_key_or_model_name_itself():
    source = (ROOT / "scripts" / "steve_eval.py").read_text(encoding="utf-8")
    assert not re.search(r"os\.environ|getenv|genai", source)  # only backend/steve/provider.py does


@pytest.mark.skipif(not HAVE_SHELF, reason="test shelf not fetched (python scripts/fetch_test_shelf.py)")
def test_every_prompt_builds_under_the_cap_with_its_expected_pages():
    shelf = steve_eval.Shelf()
    for item in ITEMS:
        ctx, prompt = steve_eval.build(item, FIXTURE["books"], shelf)
        assert ctx.tokens <= steve_eval.policy.CONTEXT_MAX_TOKENS, item["id"]
        assert set(item["expect"]) <= set(ctx.citations), item["id"]
        assert "<question>" in prompt.parts[-1] and "Allowed citation labels" in prompt.system
        if item["kind"] == "injection":
            assert item["inject"]["canary"] in prompt.parts[0]  # delimited inside the book text, never the system
            assert item["inject"]["canary"] not in prompt.system
