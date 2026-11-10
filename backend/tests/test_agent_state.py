"""AgentState: the typed LangGraph state, its append-only reducers, and the keys the existing nodes use."""

import ast
import asyncio
import operator
import typing
from pathlib import Path

from langgraph.graph import END, StateGraph

from backend.agents import evaluator_agent
from backend.agents.state import AgentState, Decision

AGENTS = Path(__file__).resolve().parents[1] / "agents"
NEW_KEYS = {
    "user_id", "book_id", "session_id", "event", "answers", "grades", "mastery_updates",
    "policy_adjustments", "plan", "decisions", "errors",
}
EXISTING_KEYS = {
    "status", "chunk_indices", "chunk_texts", "session_plan", "test_questions", "user_answers",
    "evaluation_result", "time_taken_seconds", "pace_recommendation", "enriched_context", "error",
}


def hints():
    return typing.get_type_hints(AgentState, include_extras=True)


def test_state_declares_the_pipeline_keys_and_keeps_the_old_ones():
    assert NEW_KEYS | EXISTING_KEYS <= set(hints())


def test_decisions_and_errors_are_append_only():
    for key in ("decisions", "errors"):
        annotation = hints()[key]
        assert typing.get_origin(annotation) is typing.Annotated
        assert operator.add in annotation.__metadata__


def test_event_takes_only_the_two_flows():
    assert set(typing.get_args(hints()["event"])) == {"start", "submit"}


def test_a_compiled_graph_keeps_every_node_s_decisions_in_order():
    def first(state):
        return {"decisions": [Decision(agent="first", input={}, output={"n": 1})]}

    def second(state):
        return {"decisions": [Decision(agent="second", input={}, output={"n": 2})], "errors": ["minor"]}

    def silent(state):
        return {"plan": {"chunk_indices": [0]}}

    builder = StateGraph(AgentState)
    for name, node in (("first", first), ("silent", silent), ("second", second)):
        builder.add_node(name, node)
    builder.add_edge("__start__", "first")
    builder.add_edge("first", "silent")
    builder.add_edge("silent", "second")
    builder.add_edge("second", END)
    result = builder.compile().invoke({"event": "start", "decisions": [], "errors": []})
    assert [d["agent"] for d in result["decisions"]] == ["first", "second"]
    assert result["errors"] == ["minor"] and result["plan"] == {"chunk_indices": [0]}


def returned_keys(path: Path) -> set[str]:
    """Every string key of a dict literal returned by a *_node function in the file."""
    keys: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef) and node.name.endswith("_node"):
            for ret in ast.walk(node):
                if isinstance(ret, ast.Return) and isinstance(ret.value, ast.Dict):
                    keys |= {k.value for k in ret.value.keys if isinstance(k, ast.Constant)}
    return keys


def test_every_key_a_node_returns_is_declared():
    declared = set(hints())
    for path in AGENTS.glob("*_agent.py"):
        assert returned_keys(path) <= declared, path.name


def test_the_evaluator_returns_only_its_own_decision(monkeypatch, fake_supabase):
    monkeypatch.setattr(evaluator_agent, "grade_answers", lambda qs, answers, passage="": [
        {"answer": a, "score": 5, "max_score": 10, "feedback": "", "confidence": "high",
         "matched_concepts": [], "missing_concepts": [], "method": "test", "reasons": [], "components": {}}
        for a in answers
    ])
    earlier = Decision(agent="planner", input={}, output={})
    state = {"user_id": "u", "book_id": "b", "session_id": "s", "chunk_indices": [0],
             "test_questions": [{"id": "q1", "evidence": "e"}], "user_answers": ["a"], "decisions": [earlier]}
    result = asyncio.run(evaluator_agent.evaluator_node(state))
    assert len(result["decisions"]) == 1 and result["decisions"][0]["agent"] == "evaluator"
